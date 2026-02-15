# Transcription Tool

Audio transcription with speaker diarization (AssemblyAI) and speaker identification (OpenAI structured output).

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
