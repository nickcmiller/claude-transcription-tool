# Transcription Tool

## Architecture

```
transcribe.js                  Main entry point, command handler
├── src/cli/config.js          CLI commands and options (yargs)
├── src/api/
│   ├── assemblyai.js          Transcription with speaker diarization
│   └── openai.js              Speaker identification via structured output
└── src/utils/
    ├── formatters.js          Markdown, text, JSON output formatting
    ├── storage.js             SQLite metadata storage (transcript catalog)
    ├── validators.js          Audio file and format validation
    └── youtube.js             YouTube audio download via yt-dlp
```

**Data flow**: CLI args → handler → [yt-dlp if YouTube URL] → AssemblyAI (transcribe + diarize) → OpenAI (identify speakers) → formatters → console output + file save → SQLite metadata save

## Component Responsibilities

| File | Purpose | When to Modify |
|------|---------|----------------|
| `transcribe.js` | Entry point, env setup, orchestration handler | Adding new commands, changing pipeline steps |
| `src/cli/config.js` | yargs command definitions | Adding/modifying CLI options, command aliases |
| `src/api/assemblyai.js` | AssemblyAI SDK wrapper | Changing transcription config, adding features |
| `src/api/openai.js` | Speaker ID via Zod structured output | Changing prompt, schema, or model |
| `src/utils/formatters.js` | Output formatting (markdown, text, JSON) | Changing output format, adding new formats |
| `src/utils/storage.js` | SQLite DB for transcript metadata | Changing schema, adding query functions |
| `src/utils/validators.js` | Input validation, format constants | Adding supported formats, changing validation |
| `src/utils/youtube.js` | YouTube download via yt-dlp | Changing download format, adding URL patterns |

## Transcript Database

Metadata for every transcription is stored in a SQLite database at `../transcription-data/transcription.db` (sibling directory to vault, same pattern as `../readwise-data/readwise.db`).

**Schema** — `transcripts` table, one row per transcription run:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | AssemblyAI transcript ID |
| `source_url` | TEXT | YouTube/podcast URL (null for local files) |
| `source_type` | TEXT | `'youtube'` or `'local'` |
| `title` | TEXT | Video/episode title or filename |
| `description` | TEXT | Full video/episode description |
| `channel` | TEXT | Uploader/channel/show name |
| `channel_url` | TEXT | Channel/feed URL |
| `duration_seconds` | REAL | Audio length |
| `speakers` | TEXT | JSON array of identified speaker names |
| `file_path` | TEXT | Relative path to vault markdown file |
| `created_at` | TEXT | ISO timestamp of when transcribed |
| `raw_metadata` | TEXT | Full yt-dlp JSON dump (null for local) |

Indexes on `source_type`, `channel`, `created_at`.

### Direct SQL (Preferred for Queries)

For querying transcript history, use SQLite directly — faster than running the CLI.

**Database path:** `../transcription-data/transcription.db`

```bash
# List all transcripts
sqlite3 "../transcription-data/transcription.db" "SELECT title, channel, source_type, round(duration_seconds/60.0,1) as mins FROM transcripts ORDER BY created_at DESC"

# Find by channel
sqlite3 "../transcription-data/transcription.db" "SELECT title, speakers FROM transcripts WHERE channel LIKE '%Dwarkesh%'"

# Find by speaker
sqlite3 "../transcription-data/transcription.db" "SELECT title, channel FROM transcripts WHERE speakers LIKE '%Dario%'"

# YouTube transcripts only
sqlite3 "../transcription-data/transcription.db" "SELECT title, source_url FROM transcripts WHERE source_type = 'youtube'"

# Get file path for a transcript
sqlite3 "../transcription-data/transcription.db" "SELECT file_path FROM transcripts WHERE title LIKE '%keyword%'"
```

## Modification Patterns

### Adding a New Output Format

1. Add format name to `VALID_OUTPUT_FORMATS` in `src/utils/validators.js`
2. Add format function in `src/utils/formatters.js`
3. Add format branch in `handleTranscribe()` in `transcribe.js`

### Changing Speaker Identification

1. Modify Zod schema and prompt in `src/api/openai.js`
2. Schema uses `zodResponseFormat` — changes are type-safe

### Adding a New Command

1. Add command definition in `src/cli/config.js`
2. Create handler function in `transcribe.js`
3. Register handler in the `handlers` object in `main()`

## Key Details

- **AssemblyAI SDK** handles file upload + polling automatically (no manual polling)
- **OpenAI structured output** via `client.beta.chat.completions.parse()` with Zod schema
- **Model**: `gpt-5-nano` for speaker identification (cheapest with structured output)
- **OpenAI is optional** — tool works without it, just skips speaker identification. If the API errors or context limit is exceeded, falls back to generic speaker labels gracefully.
- **YouTube support** via yt-dlp — auto-detects YouTube URLs, downloads audio to temp file, cleans up after
- **Default output**: `Resources/Transcripts/{filename}.md` in the vault
- **Metadata**: Every transcription saves a row to SQLite with source info, speakers, duration, and file path

## Dependencies

- `assemblyai` — transcription SDK
- `openai` — speaker identification
- `better-sqlite3` — transcript metadata storage
- `zod` — structured output schema
- `yargs` — CLI parsing
- `dotenv` — env vars from local `.env`
- `yt-dlp` — external binary for YouTube download (`brew install yt-dlp`)

## CLI Reference

Run `./transcribe.js --help` for full command and option documentation.
