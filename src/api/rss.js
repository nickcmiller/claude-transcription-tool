/**
 * RSS feed parser for podcast episodes.
 * Uses native fetch + fast-xml-parser — no other dependencies.
 */

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Parse an RSS duration value into minutes.
 * Handles: seconds as integer, "MM:SS", "HH:MM:SS"
 * @param {string|number} raw
 * @returns {number|null} Duration in minutes, or null
 */
function parseDuration(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Pure integer — treat as seconds
  if (/^\d+$/.test(str)) return Math.round(Number(str) / 60);

  // HH:MM:SS or MM:SS
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;

  let seconds;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else {
    return null;
  }
  return Math.round(seconds / 60);
}

/**
 * Normalize RFC 2822 date to YYYY-MM-DD.
 * @param {string} raw
 * @returns {string}
 */
function formatPubDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Fetch and parse an RSS feed URL.
 * @param {string} feedUrl - RSS feed URL
 * @param {object} [opts]
 * @param {number} [opts.limit=20] - Max episodes to return
 * @returns {Promise<{show: {name: string, author: string}, episodes: Array<{name: string, url: string, date: string, duration: number|null, description: string}>}>}
 */
export async function fetchFeed(feedUrl, { limit = 20 } = {}) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'transcription-tool/1.0' },
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);

  const xml = await res.text();
  const parsed = parser.parse(xml);

  const channel = parsed?.rss?.channel;
  if (!channel) throw new Error('Invalid RSS feed: no <channel> found');

  const show = {
    name: channel.title || 'Unknown',
    author: channel['itunes:author'] || channel.author || '',
  };

  const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

  const episodes = rawItems.slice(0, limit).map((item) => {
    // Audio URL from <enclosure> (standard) or <media:content>
    let url = '';
    if (item.enclosure) {
      url = item.enclosure['@_url'] || '';
    } else if (item['media:content']) {
      url = item['media:content']['@_url'] || '';
    }

    return {
      name: item.title || '',
      url,
      date: formatPubDate(item.pubDate),
      duration: parseDuration(item['itunes:duration']),
      description: item['itunes:summary'] || item.description || '',
    };
  });

  return { show, episodes };
}
