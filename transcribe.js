#!/usr/bin/env node

/**
 * Audio Transcription Tool
 *
 * DESCRIPTION:
 *   Transcribes audio files using AssemblyAI with speaker diarization,
 *   then identifies speakers using OpenAI structured output.
 *   Outputs Obsidian-friendly markdown, plain text, or JSON.
 *
 * USAGE:
 *   node .scripts/transcription/transcribe.js transcribe <audio-file> [options]
 *
 * EXAMPLES:
 *   node .scripts/transcription/transcribe.js transcribe recording.mp3
 *   node .scripts/transcription/transcribe.js transcribe meeting.m4a -s "Meeting between Nick and Sarah"
 *   node .scripts/transcription/transcribe.js transcribe https://youtube.com/watch?v=xxx
 *   node .scripts/transcription/transcribe.js transcribe call.wav -o "Resources/Meetings/call.md"
 *   node .scripts/transcription/transcribe.js transcribe lecture.mp3 --no-diarize --format text
 *
 * SETUP:
 *   See SETUP.md for complete installation and configuration instructions
 *
 * Run --help for detailed command options and examples.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, basename, extname } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { buildCli } from './src/cli/config.js';
import { createAssemblyAIClient } from './src/api/assemblyai.js';
import { createOpenAIClient } from './src/api/openai.js';
import { validateAudioFile } from './src/utils/validators.js';
import { isYouTubeUrl, downloadYouTubeAudio } from './src/utils/youtube.js';
import {
  mapSpeakerNames,
  formatMarkdown,
  formatText,
  formatJson,
  printConsoleOutput,
} from './src/utils/formatters.js';
import { saveTranscript, DATA_DIR } from './src/utils/storage.js';

// ============================================================================
// Environment Setup
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

// Vault root is two levels up from .scripts/transcription/
const VAULT_ROOT = resolve(__dirname, '..', '..');

/**
 * Validate environment and create API clients (deferred so --help works without keys)
 */
function initClients() {
  const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!ASSEMBLYAI_API_KEY) {
    console.error('Error: ASSEMBLYAI_API_KEY not found in .env file');
    console.error('Copy .env.example to .env and add your API key');
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.warn('Warning: OPENAI_API_KEY not set — speaker identification will be skipped');
  }

  return {
    assemblyai: createAssemblyAIClient(ASSEMBLYAI_API_KEY),
    openai: OPENAI_API_KEY ? createOpenAIClient(OPENAI_API_KEY) : null,
  };
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleTranscribe(argv) {
  const { assemblyai, openai } = initClients();

  const input = argv.audioFile;
  const diarize = !argv.noDiarize;
  const speakerContext = argv.speakers || '';
  const format = argv.format;

  // Step 0: Resolve input — YouTube URL or local file
  let audioFile;
  let youtubeTitle = null;
  let cleanup = null;

  let youtubeDescription = null;
  let youtubeUploader = null;
  let youtubeChannelUrl = null;
  let youtubeRawMetadata = null;

  if (isYouTubeUrl(input)) {
    console.log('\n🎬 Downloading YouTube audio...\n');
    const download = await downloadYouTubeAudio(input);
    audioFile = download.filePath;
    youtubeTitle = download.title;
    youtubeDescription = download.description;
    youtubeUploader = download.uploader;
    youtubeChannelUrl = download.channelUrl;
    youtubeRawMetadata = download.rawMetadata;
    cleanup = download.cleanup;
    console.log(`   Saved to temp: ${audioFile}`);
  } else {
    audioFile = resolve(input);
    validateAudioFile(audioFile);
  }

  try {
  // Step 1: Transcribe with AssemblyAI
  console.log('\n📝 Step 1/3: Transcribing audio...\n');
  const transcript = await assemblyai.transcribe(audioFile, { diarize });

  console.log(`\n✅ Transcription complete (${Math.round(transcript.audioDuration)}s audio)`);
  if (transcript.utterances.length > 0) {
    const speakers = [...new Set(transcript.utterances.map(u => u.speaker))];
    console.log(`   ${speakers.length} speaker(s) detected: ${speakers.join(', ')}`);
  }

  // Step 3: Identify speakers (if diarization enabled and OpenAI available)
  let speakerMapping = [];
  let speakerReasoning = '';

  if (diarize && transcript.utterances.length > 0 && openai) {
    console.log('\n🔍 Step 2/3: Identifying speakers...\n');

    // Build combined context from YouTube metadata + user-provided speakers
    const contextParts = [];
    if (youtubeTitle) contextParts.push(`Video title: ${youtubeTitle}`);
    if (youtubeUploader) contextParts.push(`Channel: ${youtubeUploader}`);
    if (youtubeDescription) {
      const truncated = youtubeDescription.slice(0, 1000);
      contextParts.push(`Video description: ${truncated}`);
    }
    if (speakerContext) contextParts.push(`Additional context: ${speakerContext}`);
    const combinedContext = contextParts.join('\n');

    if (contextParts.length > 0) {
      console.log(`   Using context: ${contextParts.length} source(s) (${combinedContext.length} chars)`);
    }

    const identification = await openai.identifySpeakers(transcript.utterances, combinedContext);
    speakerMapping = identification.speakers;
    speakerReasoning = identification.reasoning;

    for (const s of speakerMapping) {
      const label = s.label === s.name ? s.label : `${s.label} → ${s.name}`;
      console.log(`   ${label} (${s.confidence} confidence)`);
    }
  } else if (diarize && !openai) {
    console.log('\n⏩ Step 2/3: Skipping speaker identification (no OpenAI key)');
  } else {
    console.log('\n⏩ Step 2/3: Skipping speaker identification (diarization disabled)');
  }

  // Apply speaker name mapping
  const mappedUtterances = mapSpeakerNames(transcript.utterances, speakerMapping);

  // Step 4: Format and save output
  console.log('\n💾 Step 3/3: Saving output...\n');

  // Use YouTube title if available, otherwise derive from file path
  const sourceFilename = youtubeTitle
    ? youtubeTitle.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 100)
    : basename(audioFile, extname(audioFile));
  const metadata = {
    audioDuration: transcript.audioDuration,
    transcriptId: transcript.id,
    speakerReasoning,
    ...(youtubeTitle ? { sourceUrl: input, youtubeTitle } : {}),
  };

  let content;
  let outputExt;
  if (format === 'json') {
    content = formatJson(sourceFilename, mappedUtterances, transcript.text, metadata);
    outputExt = '.json';
  } else if (format === 'text') {
    content = formatText(mappedUtterances, transcript.text);
    outputExt = '.txt';
  } else {
    content = formatMarkdown(sourceFilename, mappedUtterances, transcript.text, metadata);
    outputExt = '.md';
  }

  // Determine output path
  let outputPath;
  if (argv.output) {
    outputPath = resolve(VAULT_ROOT, argv.output);
  } else {
    const transcriptsDir = join(VAULT_ROOT, 'Resources', 'Transcripts');
    if (!existsSync(transcriptsDir)) {
      mkdirSync(transcriptsDir, { recursive: true });
    }
    outputPath = join(transcriptsDir, `${sourceFilename}${outputExt}`);
  }

  // Ensure parent directory exists
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, content, 'utf-8');
  console.log(`   Saved to: ${outputPath}`);

  // Save transcript metadata to database
  const isYouTube = isYouTubeUrl(input);
  saveTranscript(DATA_DIR, {
    id: transcript.id,
    source_url: isYouTube ? input : null,
    source_type: isYouTube ? 'youtube' : 'local',
    title: sourceFilename,
    description: youtubeDescription,
    channel: youtubeUploader,
    channel_url: youtubeChannelUrl,
    duration_seconds: transcript.audioDuration,
    speakers: JSON.stringify(speakerMapping.map(s => s.name)),
    file_path: relative(VAULT_ROOT, outputPath),
    created_at: new Date().toISOString(),
    raw_metadata: youtubeRawMetadata,
  });

  // Console preview
  printConsoleOutput(mappedUtterances, transcript.text);

  console.log('\n✅ Done!');

  } finally {
    if (cleanup) cleanup();
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const handlers = {
    transcribe: handleTranscribe,
  };

  const cli = buildCli(handlers);
  await cli.parseAsync();
}

main();
