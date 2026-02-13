# Setup

## Prerequisites

- Node.js 18+
- AssemblyAI account and API key
- OpenAI account and API key (optional — for speaker identification)
- yt-dlp (optional — for YouTube transcription): `brew install yt-dlp`

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
- **OpenAI**: https://platform.openai.com/api-keys — uses gpt-4o-mini (very low cost)

## Verify

```bash
node .scripts/transcription/transcribe.js --help
```
