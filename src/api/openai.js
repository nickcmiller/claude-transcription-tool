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

const ParagraphsSchema = z.object({
  texts: z.array(z.string()).describe('Texts with paragraph breaks inserted'),
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
    },

    /**
     * Break long utterances into paragraphs for readability.
     * Processes each qualifying utterance individually.
     * @param {Array} utterances - Array of { speaker, text, ... } objects
     * @param {object} [opts]
     * @param {number} [opts.threshold=1500] - Char count above which to paragraph-break
     * @returns {Array} Utterances with long texts broken into paragraphs
     */
    async breakIntoParagraphs(utterances, { threshold = 1500 } = {}) {
      const longIndices = [];
      for (let i = 0; i < utterances.length; i++) {
        if (utterances[i].text.length > threshold) {
          longIndices.push(i);
        }
      }

      if (longIndices.length === 0) return utterances;

      console.log(`   Breaking ${longIndices.length} long passage(s) into paragraphs...`);
      const updated = [...utterances];

      for (const idx of longIndices) {
        try {
          const completion = await client.beta.chat.completions.parse({
            model: 'gpt-5-nano',
            messages: [
              {
                role: 'system',
                content: 'You are a text formatter. Split long spoken passages into paragraphs for readability. Preserve the exact wording.',
              },
              {
                role: 'user',
                content: [
                  'Split this long spoken passage into paragraphs at natural topic shifts.',
                  'Rules:',
                  '- Preserve exact wording — only split into chunks',
                  '- 3-6 sentences per paragraph (aim for 200-500 characters each)',
                  '- Fewer, larger paragraphs are better',
                  '',
                  updated[idx].text,
                ].join('\n'),
              },
            ],
            response_format: zodResponseFormat(ParagraphsSchema, 'paragraphs'),
          });

          const result = completion.choices[0].message.parsed;
          if (result.texts.length > 0) {
            // Merge any overly-short paragraphs (< 150 chars) with the next one
            const merged = [];
            let buffer = '';
            for (const chunk of result.texts) {
              if (buffer) {
                buffer += ' ' + chunk;
              } else {
                buffer = chunk;
              }
              if (buffer.length >= 150) {
                merged.push(buffer);
                buffer = '';
              }
            }
            if (buffer) {
              if (merged.length > 0) {
                merged[merged.length - 1] += ' ' + buffer;
              } else {
                merged.push(buffer);
              }
            }
            updated[idx] = { ...updated[idx], text: merged.join('\n\n') };
          }
        } catch (error) {
          console.warn(`   Paragraph breaking failed for passage: ${error.message}`);
        }
      }

      return updated;
    },
  };
}
