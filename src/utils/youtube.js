/**
 * YouTube audio download via yt-dlp
 */

import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';

// ============================================================================
// URL Detection
// ============================================================================

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch/,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
  /^https?:\/\/m\.youtube\.com\/watch/,
];

/**
 * Check if a string is a YouTube URL
 */
export function isYouTubeUrl(input) {
  return YOUTUBE_PATTERNS.some(p => p.test(input));
}

// ============================================================================
// Download
// ============================================================================

/**
 * Download audio from a YouTube URL using yt-dlp
 * @param {string} url - YouTube URL
 * @returns {Object} { filePath, title, cleanup }
 */
export async function downloadYouTubeAudio(url) {
  // Check yt-dlp is installed
  await checkYtDlp();

  // Get video title first (for naming the output)
  const title = await getVideoTitle(url);
  console.log(`   Video: ${title}`);

  // Download to temp directory as mp3
  const tempId = randomBytes(4).toString('hex');
  const tempPath = join(tmpdir(), `transcribe-${tempId}.mp3`);

  console.log('   Downloading audio...');

  await new Promise((resolve, reject) => {
    execFile('yt-dlp', [
      '-x',                        // Extract audio only
      '--audio-format', 'mp3',     // Convert to mp3
      '--audio-quality', '0',      // Best quality
      '-o', tempPath,              // Output path
      '--no-playlist',             // Single video only
      '--no-warnings',
      url,
    ], { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`yt-dlp failed: ${error.message}`));
        return;
      }
      resolve(stdout);
    });
  });

  // yt-dlp may add extension, check both paths
  const actualPath = existsSync(tempPath) ? tempPath : `${tempPath}.mp3`;
  if (!existsSync(actualPath) && !existsSync(tempPath)) {
    throw new Error('Download completed but output file not found');
  }

  const finalPath = existsSync(tempPath) ? tempPath : actualPath;

  return {
    filePath: finalPath,
    title,
    cleanup() {
      try {
        if (existsSync(finalPath)) unlinkSync(finalPath);
      } catch { /* ignore cleanup errors */ }
    },
  };
}

/**
 * Get video title from YouTube URL
 */
async function getVideoTitle(url) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', [
      '--get-title',
      '--no-warnings',
      url,
    ], { timeout: 30000 }, (error, stdout) => {
      if (error) {
        resolve('Unknown Video');
        return;
      }
      resolve(stdout.trim() || 'Unknown Video');
    });
  });
}

/**
 * Verify yt-dlp is installed
 */
async function checkYtDlp() {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', ['--version'], { timeout: 5000 }, (error) => {
      if (error) {
        reject(new Error(
          'yt-dlp is not installed. Install it with: brew install yt-dlp'
        ));
        return;
      }
      resolve();
    });
  });
}
