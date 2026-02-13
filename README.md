# Transcription Tool

Audio transcription with speaker diarization (AssemblyAI) and speaker identification (OpenAI structured output).

## Quick Start

```bash
node transcribe.js transcribe recording.mp3
node transcribe.js transcribe meeting.m4a -s "Meeting between Nick and Sarah"
node transcribe.js transcribe call.wav -o "Resources/Meetings/call.md"
node transcribe.js transcribe lecture.mp3 --no-diarize --format text
```

See [SETUP.md](SETUP.md) for installation and [CLAUDE.md](CLAUDE.md) for architecture.
