# Transcription Tool

Audio transcription with speaker diarization (AssemblyAI) and speaker identification (OpenAI structured output).

```
transcribe.js              Main entry point, command handlers, pipeline orchestration
├── src/cli/config.js      CLI commands and options (yargs)
├── src/api/
│   ├── assemblyai.js      Transcription + sentence segmentation
│   ├── openai.js          Speaker ID + paragraph breaking (structured output)
│   ├── itunes.js          iTunes Search API (podcast discovery)
│   └── rss.js             RSS feed parser (private/paywalled podcasts)
└── src/utils/
    ├── downloader.js      Audio download via yt-dlp (any URL)
    ├── feeds.js           Saved feed URL storage (feeds.json)
    ├── formatters.js      Markdown, text, JSON output formatting
    ├── storage.js         SQLite metadata storage + queries
    └── validators.js      Audio file and format validation
```

## Quick Start

```bash
# Transcribe audio files or URLs
node transcribe.js transcribe recording.mp3
node transcribe.js transcribe https://youtube.com/watch?v=xxx
node transcribe.js transcribe meeting.m4a -s "Meeting between Nick and Sarah"

# Search public podcasts and browse episodes
node transcribe.js podcast "lex fridman"
node transcribe.js episodes 1434243584 -n 5

# Private/paywalled RSS feeds (Stratechery, Patreon, etc.)
node transcribe.js feed add stratechery "https://example.com/private-feed"
node transcribe.js feed stratechery -n 5
node transcribe.js feed list

# Query transcript history
node transcribe.js list --channel Dwarkesh -n 10
```

See [SETUP.md](SETUP.md) for installation and [CLAUDE.md](CLAUDE.md) for architecture.
