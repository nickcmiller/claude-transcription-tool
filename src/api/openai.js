/**
 * OpenAI speaker identification via structured output
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// ============================================================================
// Schema
// ============================================================================

const SpeakerSchema = z.object({
  label: z.string().describe('Original speaker label (e.g., "Speaker A", "Speaker B")'),
  name: z.string().describe('Identified speaker name, or original label if unknown'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in identification'),
});

const SpeakerIdentificationSchema = z.object({
  speakers: z.array(SpeakerSchema).describe('Mapping of speaker labels to identified names'),
  reasoning: z.string().describe('Brief explanation of how speakers were identified'),
});

// ============================================================================
// Sampling
// ============================================================================

/**
 * Sample utterances from beginning, middle, and end for broader speaker coverage
 * @param {Array} utterances - All utterances
 * @param {number} maxTotal - Maximum total utterances to return
 * @returns {Array} Sampled utterances
 */
function sampleUtterances(utterances, maxTotal = 50) {
  if (utterances.length <= maxTotal) {
    return utterances;
  }

  const beginCount = 20;
  const midCount = 15;
  const endCount = 15;

  const beginning = utterances.slice(0, beginCount);

  const midStart = Math.floor((utterances.length - midCount) / 2);
  const middle = utterances.slice(midStart, midStart + midCount);

  const end = utterances.slice(-endCount);

  return [...beginning, ...middle, ...end];
}

// ============================================================================
// Client
// ============================================================================

/**
 * Create an OpenAI client for speaker identification
 * @param {string} apiKey - OpenAI API key
 * @returns {Object} Client with identifySpeakers method
 */
export function createOpenAIClient(apiKey) {
  const client = new OpenAI({ apiKey });

  return {
    /**
     * Identify speakers from a diarized transcript
     * @param {Array} utterances - Array of { speaker, text } objects
     * @param {string} context - Optional context about who the speakers might be
     * @returns {Object} { speakers: [{label, name, confidence}], reasoning }
     */
    async identifySpeakers(utterances, context = '') {
      if (!utterances || utterances.length === 0) {
        return { speakers: [], reasoning: 'No utterances provided' };
      }

      // Sample utterances broadly (beginning, middle, end) for better speaker coverage
      const sampled = sampleUtterances(utterances, 50);
      const excerpt = sampled
        .map(u => `${u.speaker}: ${u.text}`)
        .join('\n');

      const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))];

      const prompt = [
        'Analyze this transcript and identify who each speaker is.',
        context ? `\nContext: ${context}` : '',
        `\nSpeakers to identify: ${uniqueSpeakers.join(', ')}`,
        `\nTranscript excerpt:\n${excerpt}`,
        '\nThe excerpt contains samples from the beginning, middle, and end of the transcript.',
        '\nIdentify each speaker based on context clues in the conversation (introductions, names mentioned, roles discussed). If you cannot identify a speaker, keep their original label.',
      ].join('');

      try {
        console.log('Identifying speakers with OpenAI...');

        const completion = await client.beta.chat.completions.parse({
          model: 'gpt-5-nano',
          messages: [
            {
              role: 'system',
              content: 'You are a transcript analyst. Identify speakers from conversation context. Be conservative — only assign names when evidence is clear.',
            },
            { role: 'user', content: prompt },
          ],
          response_format: zodResponseFormat(SpeakerIdentificationSchema, 'speaker_identification'),
        });

        const result = completion.choices[0].message.parsed;
        return result;
      } catch (error) {
        console.warn(`Speaker identification failed: ${error.message}`);
        console.warn('Falling back to original speaker labels.');

        // Graceful degradation — return original labels
        return {
          speakers: uniqueSpeakers.map(label => ({
            label,
            name: label,
            confidence: 'low',
          })),
          reasoning: `Identification failed: ${error.message}`,
        };
      }
    }
  };
}
