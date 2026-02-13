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
    └── validators.js          Audio file and format validation
```

**Data flow**: CLI args → handler → AssemblyAI (transcribe + diarize) → OpenAI (identify speakers) → formatters → console output + file save

## Component Responsibilities

| File | Purpose | When to Modify |
|------|---------|----------------|
| `transcribe.js` | Entry point, env setup, orchestration handler | Adding new commands, changing pipeline steps |
| `src/cli/config.js` | yargs command definitions | Adding/modifying CLI options, command aliases |
| `src/api/assemblyai.js` | AssemblyAI SDK wrapper | Changing transcription config, adding features |
| `src/api/openai.js` | Speaker ID via Zod structured output | Changing prompt, schema, or model |
| `src/utils/formatters.js` | Output formatting (markdown, text, JSON) | Changing output format, adding new formats |
| `src/utils/validators.js` | Input validation, format constants | Adding supported formats, changing validation |

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
- **Model**: `gpt-4o-mini` for speaker identification (cheapest with structured output)
- **OpenAI is optional** — tool works without it, just skips speaker identification
- **Default output**: `Resources/Transcripts/{filename}.md` in the vault

## Dependencies

- `assemblyai` — transcription SDK
- `openai` — speaker identification
- `zod` — structured output schema
- `yargs` — CLI parsing
- `dotenv` — env vars from local `.env`

## CLI Reference

Run `./transcribe.js --help` for full command and option documentation.
