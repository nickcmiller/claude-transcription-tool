# Setup

## Prerequisites

- Node.js 18+
- AssemblyAI account and API key
- OpenAI account and API key (optional — for speaker identification)
- yt-dlp + ffmpeg (optional — for YouTube transcription): `brew install yt-dlp ffmpeg`

## Installation

1. Clone if not already present:
   ```bash
   cd .scripts && git clone https://github.com/nickcmiller/claude-transcription-tool.git transcription
   ```

2. Install dependencies:
   ```bash
   cd .scripts/transcription && npm install
   ```

3. Create `.env` from template:
   ```bash
   cp .env.example .env
   ```

4. Add your API keys to `.env`:
   ```
   ASSEMBLYAI_API_KEY=your_key_here
   OPENAI_API_KEY=your_key_here
   ```

## API Keys

- **AssemblyAI**: https://www.assemblyai.com/app/account — free tier includes hours of transcription
- **OpenAI**: https://platform.openai.com/api-keys — uses gpt-5-nano for paragraph breaking (very low cost)

## Verify

```bash
node .scripts/transcription/transcribe.js --help
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `yt-dlp: command not found` or `ffmpeg` errors | `brew install yt-dlp ffmpeg` |
| `ASSEMBLYAI_API_KEY not found` | Check `.env` exists and key is set (copy from `.env.example`) |
| `Unsupported format` | Supported: mp3, wav, m4a, flac, ogg, webm, mp4, aac, wma, aiff |
| OpenAI speaker ID skipped | `OPENAI_API_KEY` not set in `.env` — tool still works, just without speaker names |
| `File not found` | Check that audio file path is correct and file exists |

## Security Notes

- API keys live in `.env` (gitignored) — never commit this file
- `feeds.json` (gitignored) may contain private RSS URLs with auth tokens
- `raw_metadata` in the database stores full yt-dlp output which may include session info
