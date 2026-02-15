/**
 * Output formatting utilities for Transcription CLI
 */

// ============================================================================
// Timestamp Helpers
// ============================================================================

/**
 * Format milliseconds as [MM:SS]
 */
function formatTimestamp(ms) {
  if (ms == null) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
}

// ============================================================================
// Speaker Name Mapping
// ============================================================================

/**
 * Replace generic speaker labels with identified names in utterances
 * @param {Array} utterances - Array of { speaker, text, ... } objects
 * @param {Array} speakerMapping - Array of { label, name } objects
 * @returns {Array} Utterances with updated speaker names
 */
export function mapSpeakerNames(utterances, speakerMapping) {
  if (!speakerMapping || speakerMapping.length === 0) {
    return utterances;
  }

  const nameMap = {};
  for (const { label, name } of speakerMapping) {
    nameMap[label] = name;
  }

  return utterances.map(u => ({
    ...u,
    speaker: nameMap[u.speaker] || u.speaker,
  }));
}

// ============================================================================
// Format Functions
// ============================================================================

/**
 * Format transcript as Obsidian-friendly markdown
 */
export function formatMarkdown(filename, utterances, text, metadata = {}) {
  const lines = [];

  // Frontmatter
  lines.push('---');
  lines.push(`date: ${new Date().toISOString().split('T')[0]}`);
  lines.push('type: transcript');
  if (metadata.audioDuration) {
    const mins = Math.floor(metadata.audioDuration / 60);
    const secs = Math.round(metadata.audioDuration % 60);
    lines.push(`duration: ${mins}m ${secs}s`);
  }
  if (metadata.transcriptId) {
    lines.push(`assemblyai_id: ${metadata.transcriptId}`);
  }
  if (metadata.sourceUrl) {
    lines.push(`source: ${metadata.sourceUrl}`);
  }
  if (metadata.speakers && metadata.speakers.length > 0) {
    lines.push('speakers:');
    for (const speaker of metadata.speakers) {
      lines.push(`  - ${speaker}`);
    }
  }
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${filename}`);
  lines.push('');

  // Transcript body
  if (utterances && utterances.length > 0) {
    for (const u of utterances) {
      const ts = formatTimestamp(u.start);
      lines.push(`${ts} **${u.speaker}**: ${u.text}`);
      lines.push('');
    }
  } else {
    lines.push(text || '(No transcript text available)');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format transcript as plain text
 */
export function formatText(utterances, text) {
  if (utterances && utterances.length > 0) {
    return utterances.map(u => {
      const ts = formatTimestamp(u.start);
      return `${ts} ${u.speaker}: ${u.text}`;
    }).join('\n');
  }
  return text || '';
}

/**
 * Format transcript as JSON
 */
export function formatJson(filename, utterances, text, metadata = {}) {
  return JSON.stringify({
    filename,
    date: new Date().toISOString(),
    metadata,
    utterances: utterances || [],
    text: text || '',
  }, null, 2);
}

/**
 * Print a console preview of the transcript (first N utterances)
 */
export function printConsoleOutput(utterances, text, { limit = 10 } = {}) {
  console.log('\n─── Transcript Preview ───\n');

  if (utterances && utterances.length > 0) {
    const preview = utterances.slice(0, limit);
    for (const u of preview) {
      console.log(`${u.speaker}: ${u.text}`);
    }
    if (utterances.length > limit) {
      console.log(`\n... and ${utterances.length - limit} more utterances`);
    }
  } else if (text) {
    const preview = text.slice(0, 500);
    console.log(preview);
    if (text.length > 500) {
      console.log('\n... (truncated)');
    }
  } else {
    console.log('(No transcript content)');
  }

  console.log('\n──────────────────────────');
}
