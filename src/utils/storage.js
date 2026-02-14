/**
 * SQLite storage for transcript metadata
 * Follows the Readwise storage.js pattern (singleton connection, WAL mode)
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ============================================================================
// Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_FILE = 'transcription.db';
const DATABASE_VERSION = 1;

// Data directory: sibling to vault, like readwise-data/
// __dirname is src/utils/ → five levels up reaches Documents/
//   src/utils/ → src/ → transcription/ → .scripts/ → vault/ → Documents/
export const DATA_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'transcription-data');

// ============================================================================
// Database Connection Management
// ============================================================================

/** Database connection singleton per data directory */
const dbConnections = new Map();

/**
 * Get or create database connection for a data directory
 * @param {string} dataDir - Data directory path
 * @returns {Database} - SQLite database connection
 */
export function getDb(dataDir) {
  if (dbConnections.has(dataDir)) {
    return dbConnections.get(dataDir);
  }

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = join(dataDir, DATABASE_FILE);
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  initializeSchema(db);
  dbConnections.set(dataDir, db);

  return db;
}

/**
 * Close database connection for a data directory
 * @param {string} dataDir - Data directory path
 */
export function closeDb(dataDir) {
  if (dbConnections.has(dataDir)) {
    const db = dbConnections.get(dataDir);
    db.close();
    dbConnections.delete(dataDir);
  }
}

// ============================================================================
// Schema
// ============================================================================

/**
 * Initialize database schema
 * @param {Database} db - SQLite database connection
 */
function initializeSchema(db) {
  // Metadata table for versioning
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Transcripts table — one row per transcription run
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      source_url TEXT,
      source_type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      channel TEXT,
      channel_url TEXT,
      duration_seconds REAL,
      speakers TEXT,
      file_path TEXT,
      created_at TEXT NOT NULL,
      raw_metadata TEXT
    )
  `);

  // Indexes for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_source_type ON transcripts(source_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_channel ON transcripts(channel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at)`);

  // Set schema version
  const existing = db.prepare('SELECT value FROM metadata WHERE key = ?').get('db_version');
  if (!existing) {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('db_version', String(DATABASE_VERSION));
  }
}

// ============================================================================
// Transcript Storage
// ============================================================================

/**
 * Save transcript metadata to database
 * @param {string} dataDir - Data directory path
 * @param {Object} record - Transcript metadata
 */
export function saveTranscript(dataDir, record) {
  const db = getDb(dataDir);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO transcripts (
      id, source_url, source_type, title, description,
      channel, channel_url, duration_seconds, speakers,
      file_path, created_at, raw_metadata
    ) VALUES (
      @id, @source_url, @source_type, @title, @description,
      @channel, @channel_url, @duration_seconds, @speakers,
      @file_path, @created_at, @raw_metadata
    )
  `);

  stmt.run({
    id: record.id,
    source_url: record.source_url ?? null,
    source_type: record.source_type,
    title: record.title ?? null,
    description: record.description ?? null,
    channel: record.channel ?? null,
    channel_url: record.channel_url ?? null,
    duration_seconds: record.duration_seconds ?? null,
    speakers: record.speakers ?? null,
    file_path: record.file_path ?? null,
    created_at: record.created_at,
    raw_metadata: record.raw_metadata ?? null,
  });
}
