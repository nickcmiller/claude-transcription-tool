#!/usr/bin/env node

/**
 * Audio Transcription Tool
 *
 * DESCRIPTION:
 *   Transcribes audio files or URLs (YouTube, podcasts, etc.) using AssemblyAI
 *   with speaker diarization, then identifies speakers using OpenAI structured
 *   output. Outputs Obsidian-friendly markdown, plain text, or JSON.
 *   Saves transcript metadata to SQLite at ../transcription-data/transcription.db.
 *
 * USAGE:
 *   node .scripts/transcription/transcribe.js transcribe <audio-file-or-url> [options]
 *   node .scripts/transcription/transcribe.js list [options]
 *   node .scripts/transcription/transcribe.js podcast <query>
 *   node .scripts/transcription/transcribe.js episodes <id> [-n limit]
 *   node .scripts/transcription/transcribe.js feed <url-or-name> [-n limit]
 *   node .scripts/transcription/transcribe.js feed add|rm|list
 *
 * EXAMPLES:
 *   node .scripts/transcription/transcribe.js transcribe recording.mp3
 *   node .scripts/transcription/transcribe.js transcribe meeting.m4a -s "Meeting between Nick and Sarah"
 *   node .scripts/transcription/transcribe.js transcribe https://youtube.com/watch?v=xxx
 *   node .scripts/transcription/transcribe.js transcribe https://podcast-host.com/episode.mp3
 *   node .scripts/transcription/transcribe.js transcribe call.wav -o "Resources/Meetings/call.md"
 *   node .scripts/transcription/transcribe.js transcribe lecture.mp3 --no-diarize --format text
 *   node .scripts/transcription/transcribe.js list --channel Dwarkesh -n 10
 *   node .scripts/transcription/transcribe.js feed add stratechery "https://example.com/feed"
 *   node .scripts/transcription/transcribe.js feed stratechery -n 5
 *
 * OUTPUT:
 *   - Markdown/text/JSON file → Resources/Transcripts/ (or custom -o path)
 *   - Metadata row → ../transcription-data/transcription.db (source, speakers, duration, etc.)
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
import { isUrl, isYouTubeUrl, downloadAudio } from './src/utils/downloader.js';
import {
  mapSpeakerNames,
  formatMarkdown,
  formatText,
  formatJson,
  printConsoleOutput,
} from './src/utils/formatters.js';
import { saveTranscript, findBySourceUrl, listTranscripts } from './src/utils/storage.js';
import { searchPodcasts, getEpisodes } from './src/api/itunes.js';
import { fetchFeed } from './src/api/rss.js';
import { loadFeeds, addFeed, removeFeed, getFeedUrl } from './src/utils/feeds.js';

// ============================================================================
// Environment Setup
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

// Vault root is two levels up from .scripts/transcription/
const VAULT_ROOT = resolve(__dirname, '..', '..');

// Data directory: sibling to vault, like readwise-data/
const DATA_DIR = resolve(VAULT_ROOT, '..', 'transcription-data');

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
// Helpers
// ============================================================================

/**
 * Group sentences into segments of roughly maxChars characters each,
 * preserving start/end timestamps from the first/last sentence in each group.
 */
function groupSentences(sentences, maxChars = 4000) {
  const grouped = [];
  let current = { speaker: sentences[0].speaker, text: '', start: sentences[0].start, end: 0 };
  for (const s of sentences) {
    if (current.text.length + s.text.length > maxChars && current.text.length > 0) {
      grouped.push({ ...current });
      current = { speaker: s.speaker, text: '', start: s.start, end: 0 };
    }
    current.text += (current.text ? ' ' : '') + s.text;
    current.end = s.end;
  }
  if (current.text) grouped.push(current);
  return grouped;
}

/**
 * Split long multi-speaker utterances using sentence segmentation.
 * Short utterances pass through unchanged. Long ones are replaced by
 * sentence-grouped chunks that keep the original speaker and start timestamp.
 */
function splitLongUtterances(utterances, sentences, threshold = 4000) {
  const result = [];
  for (const u of utterances) {
    if (u.text.length <= threshold) {
      result.push(u);
      continue;
    }
    // Find sentences that belong to this utterance by timestamp overlap
    const uSentences = sentences.filter(s => s.start >= u.start && s.end <= u.end);
    if (uSentences.length === 0) {
      result.push(u);
      continue;
    }
    const groups = groupSentences(uSentences, threshold);
    for (const g of groups) {
      result.push({ ...u, text: g.text, start: g.start, end: g.end });
    }
  }
  return result;
}

/**
 * Build a context string for speaker identification from source metadata
 * and any user-provided speaker hint (e.g. "Meeting between Nick and Sarah").
 */
function buildSpeakerContext(sourceInfo, speakerHint) {
  const parts = [];
  if (sourceInfo.title) parts.push(`Video title: ${sourceInfo.title}`);
  if (sourceInfo.uploader) parts.push(`Channel: ${sourceInfo.uploader}`);
  if (sourceInfo.description) parts.push(`Video description: ${sourceInfo.description.slice(0, 1000)}`);
  if (speakerHint) parts.push(`Additional context: ${speakerHint}`);
  return parts.join('\n');
}

/**
 * Run speaker identification and paragraph breaking via OpenAI.
 *
 * Three modes depending on available config:
 *   1. diarize + openai  → speaker ID and paragraph breaking run concurrently
 *   2. openai only       → paragraph breaking only (no speaker ID)
 *   3. no openai         → pass utterances through unchanged
 *
 * @returns {{ utterances, speakers: Array, reasoning: string }}
 */
async function identifyAndFormat(openai, utterances, { diarize, context }) {
  const empty = { utterances, speakers: [], reasoning: '' };

  if (utterances.length === 0 || !openai) {
    if (diarize && !openai) {
      console.log('\n⏩ Step 2/3: Skipping speaker identification (no OpenAI key)');
    }
    return empty;
  }

  if (!diarize) {
    console.log('\n⏩ Step 2/3: Skipping speaker identification (diarization disabled)');
    return { ...empty, utterances: await openai.breakIntoParagraphs(utterances) };
  }

  // Full pipeline — speaker ID and paragraph breaking are independent, run concurrently
  console.log('\n🔍 Step 2/3: Identifying speakers + formatting...\n');
  if (context) {
    console.log(`   Using context: ${context.split('\n').length} source(s) (${context.length} chars)`);
  }

  const [identification, broken] = await Promise.all([
    openai.identifySpeakers(utterances, context),
    openai.breakIntoParagraphs(utterances),
  ]);

  for (const s of identification.speakers) {
    const label = s.label === s.name ? s.label : `${s.label} → ${s.name}`;
    console.log(`   ${label} (${s.confidence} confidence)`);
  }

  return {
    utterances: mapSpeakerNames(broken, identification.speakers),
    speakers: identification.speakers,
    reasoning: identification.reasoning,
  };
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Main transcription pipeline:
 *
 *   1. Resolve input (URL download or local file validation)
 *   2. Transcribe via AssemblyAI (upload, transcribe, diarize)
 *   3. Pre-chunk long utterances via sentence segmentation (free AssemblyAI endpoint)
 *   4. Identify speakers + paragraph-break via OpenAI (concurrent, optional)
 *   5. Format output (markdown/text/JSON) and save to vault + SQLite
 */
async function handleTranscribe(argv) {
  const { assemblyai, openai } = initClients();

  const input = argv.audioFile;
  const diarize = !argv.noDiarize;
  const speakerContext = argv.speakers || '';
  const format = argv.format;

  // Resolve input — URL or local file
  let sourceInfo;

  if (isUrl(input)) {
    // Check for duplicate URL (unless --force)
    if (!argv.force) {
      const existing = findBySourceUrl(DATA_DIR, input);
      if (existing) {
        console.error(`\n⚠️  This URL was already transcribed:`);
        console.error(`   Title: ${existing.title}`);
        console.error(`   Date:  ${existing.created_at}`);
        console.error(`\n   Use --force to re-transcribe.`);
        process.exit(1);
      }
    }

    const label = isYouTubeUrl(input) ? 'YouTube' : 'URL';
    console.log(`\n🎬 Downloading ${label} audio...\n`);
    const download = await downloadAudio(input);
    sourceInfo = { ...download, isUrl: true };
    console.log(`   Saved to temp: ${sourceInfo.filePath}`);
  } else {
    sourceInfo = { filePath: resolve(input), cleanup: null, isUrl: false };
    validateAudioFile(sourceInfo.filePath);
  }

  if (argv.title) {
    sourceInfo.title = argv.title;
  }

  try {
    // Step 1: Transcribe with AssemblyAI
    console.log('\n📝 Step 1/3: Transcribing audio...\n');
    const transcript = await assemblyai.transcribe(sourceInfo.filePath, { diarize });

    console.log(`\n✅ Transcription complete (${Math.round(transcript.audioDuration)}s audio)`);
    const speakers = transcript.utterances.length > 0
      ? [...new Set(transcript.utterances.map(u => u.speaker))]
      : [];
    if (speakers.length > 0) {
      console.log(`   ${speakers.length} speaker(s) detected: ${speakers.join(', ')}`);
    }

    // Split long utterances using AssemblyAI sentence segmentation
    const CHUNK_THRESHOLD = 4000;
    const hasLongUtterances = transcript.utterances.some(u => u.text.length > CHUNK_THRESHOLD);

    if (hasLongUtterances) {
      console.log('   Fetching sentence segmentation for long utterance(s)...');
      const sentences = await assemblyai.getSentences(transcript.id);

      if (speakers.length === 1) {
        // Single speaker: group all sentences into timestamped segments
        transcript.utterances = groupSentences(sentences);
      } else {
        // Multi-speaker: replace only the long utterances with sentence-grouped chunks
        transcript.utterances = splitLongUtterances(transcript.utterances, sentences, CHUNK_THRESHOLD);
      }
      console.log(`   Grouped ${sentences.length} sentences into ${transcript.utterances.length} segment(s)`);
    }

    // Step 2: Identify speakers + break into paragraphs
    const context = buildSpeakerContext(sourceInfo, speakerContext);
    const {
      utterances: mappedUtterances,
      speakers: speakerMapping,
      reasoning: speakerReasoning,
    } = await identifyAndFormat(openai, transcript.utterances, { diarize, context });

    // Step 3: Format and save output
    console.log('\n💾 Step 3/3: Saving output...\n');

    // Use source title if available, otherwise derive from file path
    const sourceFilename = sourceInfo.title
      ? sourceInfo.title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 100)
      : basename(sourceInfo.filePath, extname(sourceInfo.filePath));
    const speakerNames = speakerMapping.map(s => s.name);
    const metadata = {
      audioDuration: transcript.audioDuration,
      transcriptId: transcript.id,
      speakerReasoning,
      speakers: speakerNames,
      ...(sourceInfo.isUrl ? { sourceUrl: input, sourceTitle: sourceInfo.title } : {}),
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

    // Handle file collisions — append (2), (3), etc. if file exists
    if (existsSync(outputPath)) {
      const base = basename(outputPath, outputExt);
      let counter = 2;
      while (existsSync(join(outputDir, `${base} (${counter})${outputExt}`))) {
        counter++;
      }
      outputPath = join(outputDir, `${base} (${counter})${outputExt}`);
    }

    writeFileSync(outputPath, content, 'utf-8');
    console.log(`   Saved to: ${outputPath}`);

    // Save transcript metadata to database
    saveTranscript(DATA_DIR, {
      id: transcript.id,
      source_url: sourceInfo.isUrl ? input : null,
      source_type: sourceInfo.isUrl ? (isYouTubeUrl(input) ? 'youtube' : 'url') : 'local',
      title: sourceFilename,
      description: sourceInfo.description || null,
      channel: sourceInfo.uploader || null,
      channel_url: sourceInfo.channelUrl || null,
      duration_seconds: transcript.audioDuration,
      speakers: JSON.stringify(speakerNames),
      file_path: relative(VAULT_ROOT, outputPath),
      created_at: new Date().toISOString(),
      raw_metadata: sourceInfo.rawMetadata || null,
      content: content,
    });

    // Console preview
    printConsoleOutput(mappedUtterances, transcript.text);

    console.log('\n✅ Done!');

  } finally {
    if (sourceInfo.cleanup) sourceInfo.cleanup();
  }
}

async function handleList(argv) {
  const rows = listTranscripts(DATA_DIR, {
    channel: argv.channel,
    speaker: argv.speaker,
    sourceType: argv.sourceType,
    limit: argv.limit,
  });

  if (rows.length === 0) {
    console.log('No transcripts found.');
    return;
  }

  // Print formatted table
  const header = `${'Title'.padEnd(50)} ${'Channel'.padEnd(20)} ${'Type'.padEnd(8)} ${'Mins'.padEnd(6)} Date`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const row of rows) {
    const title = (row.title || '').slice(0, 48).padEnd(50);
    const channel = (row.channel || '—').slice(0, 18).padEnd(20);
    const type = (row.source_type || '').padEnd(8);
    const mins = row.duration_seconds
      ? String(Math.round(row.duration_seconds / 60)).padEnd(6)
      : '—'.padEnd(6);
    const date = row.created_at ? row.created_at.split('T')[0] : '—';
    console.log(`${title} ${channel} ${type} ${mins} ${date}`);
  }

  console.log(`\n${rows.length} transcript(s) shown.`);
}

async function handlePodcast(argv) {
  const results = await searchPodcasts(argv.query, { limit: argv.limit });

  if (results.length === 0) {
    console.log(`No podcasts found for "${argv.query}".`);
    return;
  }

  const header = `${'ID'.padEnd(12)} ${'Podcast'.padEnd(35)} ${'Artist'.padEnd(22)} ${'Eps'.padEnd(5)} Genre`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const r of results) {
    const id = String(r.id).padEnd(12);
    const name = r.name.slice(0, 33).padEnd(35);
    const artist = r.artist.slice(0, 20).padEnd(22);
    const eps = String(r.episodeCount).padEnd(5);
    console.log(`${id} ${name} ${artist} ${eps} ${r.genre}`);
  }

  console.log(`\n${results.length} result(s). Use: episodes <ID> to browse episodes.`);
}

async function handleEpisodes(argv) {
  const { show, episodes } = await getEpisodes(argv.id, { limit: argv.limit });

  if (episodes.length === 0) {
    console.log(`No episodes found for podcast ID ${argv.id}.`);
    return;
  }

  console.log(`\n${show.name} — ${show.artist}\n`);

  const header = `${'Date'.padEnd(12)} ${'Mins'.padEnd(6)} ${'Episode'.padEnd(50)} URL`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const ep of episodes) {
    const date = ep.date.padEnd(12);
    const mins = (ep.duration ? String(ep.duration) : '—').padEnd(6);
    const name = ep.name.slice(0, 48).padEnd(50);
    console.log(`${date} ${mins} ${name} ${ep.url}`);
  }

  console.log(`\n${episodes.length} episode(s). Use: transcribe <URL> to transcribe.`);
}

async function handleFeed(argv) {
  const source = argv.source || [];
  const sub = source[0] || '';

  // Subcommands: add, rm, list
  if (sub === 'list') {
    const feeds = loadFeeds();
    const entries = Object.entries(feeds);
    if (entries.length === 0) {
      console.log('No saved feeds. Use: feed add <name> <url>');
      return;
    }
    for (const [name] of entries) {
      console.log(`  ${name}`);
    }
    console.log(`\n${entries.length} feed(s) saved.`);
    return;
  }

  if (sub === 'add') {
    const name = source[1];
    const url = source[2];
    if (!name || !url) {
      console.error('Usage: feed add <name> <url>');
      process.exit(1);
    }
    addFeed(name, url);
    console.log(`Saved feed "${name.toLowerCase()}" → ${url}`);
    return;
  }

  if (sub === 'rm') {
    const name = source[1];
    if (!name) {
      console.error('Usage: feed rm <name>');
      process.exit(1);
    }
    if (removeFeed(name)) {
      console.log(`Removed feed "${name.toLowerCase()}".`);
    } else {
      console.error(`Feed "${name.toLowerCase()}" not found.`);
      process.exit(1);
    }
    return;
  }

  // Fetch episodes — from URL or saved name
  if (!sub) {
    console.error('Usage: feed <url-or-name> [-n limit]');
    console.error('       feed add <name> <url>');
    console.error('       feed rm <name>');
    console.error('       feed list');
    process.exit(1);
  }

  let feedUrl;
  if (isUrl(sub)) {
    feedUrl = sub;
  } else {
    feedUrl = getFeedUrl(sub);
    if (!feedUrl) {
      console.error(`Feed "${sub}" not found. Use "feed list" to see saved feeds.`);
      process.exit(1);
    }
  }

  const { show, episodes } = await fetchFeed(feedUrl, { limit: argv.limit });

  if (episodes.length === 0) {
    console.log('No episodes found in this feed.');
    return;
  }

  console.log(`\n${show.name}${show.author ? ` — ${show.author}` : ''}\n`);

  const header = `${'Date'.padEnd(12)} ${'Mins'.padEnd(6)} ${'Episode'.padEnd(50)} URL`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const ep of episodes) {
    const date = (ep.date || '—').padEnd(12);
    const mins = (ep.duration != null ? String(ep.duration) : '—').padEnd(6);
    const name = (ep.name || '').slice(0, 48).padEnd(50);
    console.log(`${date} ${mins} ${name} ${ep.url}`);
  }

  console.log(`\n${episodes.length} episode(s). Use: transcribe <URL> to transcribe.`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const handlers = {
    transcribe: handleTranscribe,
    list: handleList,
    podcast: handlePodcast,
    episodes: handleEpisodes,
    feed: handleFeed,
  };

  const cli = buildCli(handlers);
  await cli.parseAsync();
}

main();
