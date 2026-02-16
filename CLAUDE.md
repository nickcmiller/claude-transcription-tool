# Transcription Tool

## Architecture

```
transcribe.js                  Main entry point, command handlers
├── src/cli/config.js          CLI commands and options (yargs)
├── src/api/
│   ├── assemblyai.js          Transcription with speaker diarization
│   ├── openai.js              Speaker identification via structured output
│   ├── itunes.js              iTunes Search API (podcast discovery)
│   └── rss.js                 RSS feed parser (private/paywalled podcasts)
└── src/utils/
    ├── downloader.js          Audio download via yt-dlp (any URL)
    ├── feeds.js               Saved feed URL storage (feeds.json)
    ├── formatters.js          Markdown, text, JSON output formatting
    ├── storage.js             SQLite metadata storage + queries
    └── validators.js          Audio file and format validation
```

**Data flow**: CLI args → handler → [yt-dlp if URL] → AssemblyAI (transcribe + diarize) → [sentence segmentation for long utterances] → OpenAI (identify speakers + paragraph breaking, concurrent) → formatters → console output + file save → SQLite metadata save

## Component Responsibilities

| File | Purpose | When to Modify |
|------|---------|----------------|
| `transcribe.js` | Entry point, env setup, orchestration handler | Adding new commands, changing pipeline steps |
| `src/cli/config.js` | yargs command definitions | Adding/modifying CLI options, command aliases |
| `src/api/assemblyai.js` | AssemblyAI SDK wrapper | Changing transcription config, adding features |
| `src/api/openai.js` | Speaker ID via Zod structured output | Changing prompt, schema, or model |
| `src/utils/formatters.js` | Output formatting (markdown, text, JSON) | Changing output format, adding new formats |
| `src/utils/storage.js` | SQLite DB for transcript metadata + queries | Changing schema, adding query functions |
| `src/utils/validators.js` | Input validation, format constants | Adding supported formats, changing validation |
| `src/api/itunes.js` | iTunes podcast search + episode listing | Changing API params, adding podcast metadata |
| `src/api/rss.js` | RSS feed fetch + parse (private feeds) | Changing XML parsing, adding feed metadata |
| `src/utils/downloader.js` | Audio download via yt-dlp (any URL) | Changing download format, adding URL support |
| `src/utils/feeds.js` | Saved feed URL storage (`feeds.json`) | Changing storage format, adding feed metadata |

## Transcript Database

Metadata for every transcription is stored in a SQLite database at `../transcription-data/transcription.db` (sibling directory to vault, same pattern as `../readwise-data/readwise.db`).

**Schema** — `transcripts` table, one row per transcription run:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | AssemblyAI transcript ID |
| `source_url` | TEXT | YouTube/podcast URL (null for local files) |
| `source_type` | TEXT | `'youtube'`, `'url'`, or `'local'` |
| `title` | TEXT | Video/episode title or filename |
| `description` | TEXT | Full video/episode description |
| `channel` | TEXT | Uploader/channel/show name |
| `channel_url` | TEXT | Channel/feed URL |
| `duration_seconds` | REAL | Audio length |
| `speakers` | TEXT | JSON array of identified speaker names |
| `file_path` | TEXT | Relative path to vault markdown file |
| `created_at` | TEXT | ISO timestamp of when transcribed |
| `raw_metadata` | TEXT | Full yt-dlp JSON dump (null for local) |
| `content` | TEXT | Full formatted transcript text (markdown/text/JSON) |

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

# Get transcript content directly from DB (no need to read vault file)
sqlite3 "../transcription-data/transcription.db" "SELECT content FROM transcripts WHERE title LIKE '%keyword%'"
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

### Transcribing a Podcast by Name

When the user asks to transcribe a podcast episode by name (e.g. "transcribe the latest Stratechery"), check saved feeds first:

1. Run `feed list` to see if a feed is saved for that podcast
2. If found, run `feed <name> -n 5` to get recent episodes with audio URLs
3. Run `transcribe <audio-url> -t "Episode Title"` with the episode URL and title from the results. **Always pass `--title`** for feed/URL sources — without it, the output filename comes from the URL slug instead of the episode title.

If no saved feed exists, fall back to `podcast <name>` → `episodes <id>` for public podcasts via iTunes.

## Key Details

- **AssemblyAI SDK** handles file upload + polling automatically (no manual polling)
- **OpenAI structured output** via `client.beta.chat.completions.parse()` with Zod schema
- **Models**: `gpt-5` for multi-speaker identification, `gpt-5-mini` for single-speaker identification, `gpt-5-nano` for paragraph breaking
- **OpenAI is optional** — tool works without it, just skips speaker identification and paragraph breaking. If the API errors or context limit is exceeded, falls back gracefully.
- **Long utterance handling** — any utterance over 4000 chars triggers AssemblyAI sentence segmentation (free). Single-speaker: all sentences grouped into ~4000-char timestamped segments. Multi-speaker: only long utterances are split at sentence boundaries, short ones pass through unchanged. Uses gpt-5-mini (cheaper) for single-speaker ID instead of gpt-5.
- **Paragraph breaking** — utterances over 1500 chars are sent to gpt-5-nano to insert `\n\n` at natural boundaries. Runs automatically when OpenAI is available. Long utterances are pre-chunked by the orchestrator via sentence segmentation, so each passage sent to the model is already ~4000 chars or less.
- **Concurrent processing** — speaker identification and paragraph breaking run in parallel via Promise.all since they're independent.
- **Cost logging** — all paid API calls (AssemblyAI, OpenAI) log duration/token usage and estimated cost to stdout.
- **URL support** via yt-dlp — works with any yt-dlp-supported URL (YouTube, podcasts, etc.), downloads audio to temp file, cleans up after
- **Title override** (`--title` / `-t`) — overrides the title derived from yt-dlp metadata or URL filename; use when transcribing private feed episodes or any URL where the filename doesn't reflect the actual title
- **URL deduplication** — warns and exits if a URL was already transcribed; use `--force` to override
- **File collision handling** — auto-appends `(2)`, `(3)`, etc. if output file already exists
- **Utterance timestamps** — `[MM:SS]` prefix on each utterance in markdown and text output
- **Speakers in frontmatter** — identified speaker names are included in markdown YAML frontmatter
- **Default output**: `Resources/Transcripts/{filename}.md` in the vault
- **Metadata + Content**: Every transcription saves a row to SQLite with source info, speakers, duration, file path, and the full transcript content (enables cross-tool workflows without reading vault files)
- **`list` command** — query transcript history from the CLI with filters (channel, speaker, source type)
- **`podcast` command** — search for podcasts by name via iTunes Search API (no auth required)
- **`episodes` command** — list recent episodes for a podcast by iTunes ID, with direct audio URLs for transcription
- **`feed` command** — fetch RSS feed episodes (supports saved private feeds with auth tokens in URL); saved feeds stored in `feeds.json` (gitignored)

## Dependencies

- `assemblyai` — transcription SDK
- `openai` — speaker identification
- `better-sqlite3` — transcript metadata storage
- `zod` — structured output schema
- `yargs` — CLI parsing
- `dotenv` — env vars from local `.env`
- `fast-xml-parser` — RSS/XML feed parsing
- `yt-dlp` — external binary for audio download (`brew install yt-dlp`)

## CLI Reference

Run `./transcribe.js --help` for full command and option documentation.
