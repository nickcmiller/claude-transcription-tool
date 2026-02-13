/**
 * Validation utilities for Transcription CLI
 */

import { existsSync } from 'fs';
import { extname } from 'path';

// ============================================================================
// Constants
// ============================================================================

export const SUPPORTED_FORMATS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.wma', '.aac', '.mp4', '.webm'];

export const VALID_OUTPUT_FORMATS = ['markdown', 'text', 'json'];

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that audio file exists and has a supported format
 * @param {string} filePath - Path to audio file
 * @returns {string} Validated file path
 */
export function validateAudioFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Audio file path is required');
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(
      `Unsupported format: ${ext}\nSupported formats: ${SUPPORTED_FORMATS.join(', ')}`
    );
  }

  return filePath;
}

/**
 * Validate output format
 * @param {string} format - Output format string
 * @returns {string} Validated format
 */
export function validateOutputFormat(format) {
  const normalized = format.toLowerCase();
  if (!VALID_OUTPUT_FORMATS.includes(normalized)) {
    throw new Error(
      `Invalid format: ${format}\nValid formats: ${VALID_OUTPUT_FORMATS.join(', ')}`
    );
  }
  return normalized;
}
