/**
 * SQLite storage for transcript metadata
 * Follows the Readwise storage.js pattern (singleton connection, WAL mode)
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Constants
// ============================================================================

const DATABASE_FILE = 'transcription.db';
const DATABASE_VERSION = 2;

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
      raw_metadata TEXT,
      content TEXT
    )
  `);

  // Indexes for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_source_type ON transcripts(source_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_channel ON transcripts(channel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at)`);

  // Migrate from v1 → v2: add content column
  const existing = db.prepare('SELECT value FROM metadata WHERE key = ?').get('db_version');
  if (existing && Number(existing.value) < 2) {
    const columns = db.pragma('table_info(transcripts)').map(c => c.name);
    if (!columns.includes('content')) {
      db.exec('ALTER TABLE transcripts ADD COLUMN content TEXT');
    }
  }

  // Set or update schema version
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('db_version', String(DATABASE_VERSION));
}

// ============================================================================
// Transcript Queries
// ============================================================================

/**
 * Find an existing transcript by source URL
 * @param {string} dataDir - Data directory path
 * @param {string} url - Source URL to search for
 * @returns {Object|null} Transcript record or null
 */
export function findBySourceUrl(dataDir, url) {
  const db = getDb(dataDir);
  return db.prepare('SELECT id, title, created_at FROM transcripts WHERE source_url = ?').get(url) || null;
}

/**
 * List transcripts with optional filters
 * @param {string} dataDir - Data directory path
 * @param {Object} filters - Optional filters { channel, speaker, limit, sourceType }
 * @returns {Array} Array of transcript records
 */
export function listTranscripts(dataDir, { channel, speaker, limit = 20, sourceType } = {}) {
  const db = getDb(dataDir);

  const conditions = [];
  const params = [];

  if (channel) {
    conditions.push('channel LIKE ?');
    params.push(`%${channel}%`);
  }
  if (speaker) {
    conditions.push('speakers LIKE ?');
    params.push(`%${speaker}%`);
  }
  if (sourceType) {
    conditions.push('source_type = ?');
    params.push(sourceType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT title, channel, source_type, duration_seconds, created_at FROM transcripts ${where} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
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
      file_path, created_at, raw_metadata, content
    ) VALUES (
      @id, @source_url, @source_type, @title, @description,
      @channel, @channel_url, @duration_seconds, @speakers,
      @file_path, @created_at, @raw_metadata, @content
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
    content: record.content ?? null,
  });
}
