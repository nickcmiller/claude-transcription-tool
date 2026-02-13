/**
 * CLI configuration using yargs for Transcription tool
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { validateOutputFormat, SUPPORTED_FORMATS, VALID_OUTPUT_FORMATS } from '../utils/validators.js';

export function buildCli(handlers) {
  return yargs(hideBin(process.argv))
    .scriptName('node .scripts/transcription/transcribe.js')
    .usage('Usage: $0 <command> [options]')
    .demandCommand(1, 'Error: Command required. Use --help to see available commands.')
    .strict()
    .help('help')
    .alias('help', 'h')
    .version(false)
    .fail((msg, err, yargs) => {
      if (err) {
        console.error('\n❌ Error:', err.message);

        if (err.message.includes('yt-dlp') || err.message.includes('ffmpeg')) {
          console.error('\n💡 Tip: Install dependencies with: brew install yt-dlp ffmpeg');
        } else if (err.message.includes('File not found')) {
          console.error('\n💡 Tip: Check that the audio file path is correct');
        } else if (err.message.includes('Unsupported format')) {
          console.error(`\n💡 Supported: ${SUPPORTED_FORMATS.join(', ')}`);
        } else if (err.message.includes('ASSEMBLYAI') || err.message.includes('AssemblyAI')) {
          console.error('\n💡 Tip: Check your ASSEMBLYAI_API_KEY in the .env file');
        } else if (err.message.includes('OPENAI') || err.message.includes('OpenAI')) {
          console.error('\n💡 Tip: Check your OPENAI_API_KEY in the .env file');
        }

        process.exit(1);
      } else {
        console.error(msg);
        console.error('\nRun with --help for usage information');
        process.exit(1);
      }
    })

    // ============================================================================
    // transcribe command
    // ============================================================================
    .command(
      ['transcribe <audio-file>', 'tx <audio-file>'],
      'Transcribe an audio file or YouTube URL with optional speaker diarization',
      (yargs) => {
        return yargs
          .positional('audio-file', {
            describe: 'Path to audio file or YouTube URL',
            type: 'string',
          })
          .option('speakers', {
            alias: 's',
            describe: 'Context about who the speakers are (e.g., "Meeting between Nick and Sarah")',
            type: 'string',
          })
          .option('output', {
            alias: 'o',
            describe: 'Output file path (default: Resources/Transcripts/{filename}.md)',
            type: 'string',
          })
          .option('format', {
            alias: 'f',
            describe: 'Output format',
            type: 'string',
            default: 'markdown',
            choices: VALID_OUTPUT_FORMATS,
          })
          .option('no-diarize', {
            describe: 'Disable speaker diarization',
            type: 'boolean',
            default: false,
          })
          .example('$0 transcribe recording.mp3', 'Basic transcription with diarization')
          .example('$0 transcribe meeting.m4a -s "Meeting between Nick and Sarah"', 'With speaker context')
          .example('$0 transcribe https://youtube.com/watch?v=xxx', 'Transcribe a YouTube video')
          .example('$0 transcribe call.wav -o "Resources/Meetings/call.md"', 'Custom output path')
          .example('$0 transcribe lecture.mp3 --no-diarize --format text', 'No diarization, plain text');
      },
      handlers.transcribe
    );
}
