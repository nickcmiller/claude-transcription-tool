/**
 * Saved RSS feed URL storage.
 * Manages feeds.json in the project root (next to .env).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEEDS_PATH = join(__dirname, '..', '..', 'feeds.json');

/**
 * Load saved feeds from feeds.json.
 * @returns {Object} Map of { name: url } (empty object if file missing)
 */
export function loadFeeds() {
  try {
    return JSON.parse(readFileSync(FEEDS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Save a feed URL under a name (upsert).
 * @param {string} name - Feed name (case-insensitive)
 * @param {string} url - RSS feed URL
 */
export function addFeed(name, url) {
  const feeds = loadFeeds();
  feeds[name.toLowerCase()] = url;
  writeFileSync(FEEDS_PATH, JSON.stringify(feeds, null, 2) + '\n', 'utf-8');
}

/**
 * Remove a saved feed by name.
 * @param {string} name - Feed name (case-insensitive)
 * @returns {boolean} True if feed existed and was removed
 */
export function removeFeed(name) {
  const feeds = loadFeeds();
  const key = name.toLowerCase();
  if (!(key in feeds)) return false;
  delete feeds[key];
  writeFileSync(FEEDS_PATH, JSON.stringify(feeds, null, 2) + '\n', 'utf-8');
  return true;
}

/**
 * Look up a saved feed URL by name.
 * @param {string} name - Feed name (case-insensitive)
 * @returns {string|null} Feed URL or null if not found
 */
export function getFeedUrl(name) {
  const feeds = loadFeeds();
  return feeds[name.toLowerCase()] || null;
}
