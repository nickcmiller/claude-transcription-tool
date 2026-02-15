/**
 * AssemblyAI transcription client
 */

import { AssemblyAI } from 'assemblyai';

const ASSEMBLYAI_PRICING = { perHour: 0.37 };

/**
 * Create an AssemblyAI client for transcription
 * @param {string} apiKey - AssemblyAI API key
 * @returns {Object} Client with transcribe method
 */
export function createAssemblyAIClient(apiKey) {
  const client = new AssemblyAI({ apiKey });

  return {
    /**
     * Transcribe an audio file with optional speaker diarization
     * SDK handles upload + polling automatically
     * @param {string} filePath - Path to audio file
     * @param {Object} options
     * @param {boolean} options.diarize - Enable speaker diarization
     * @returns {Object} { text, utterances, audioDuration, id }
     */
    async transcribe(filePath, { diarize = true } = {}) {
      const config = {
        audio: filePath,
        speaker_labels: diarize,
      };

      console.log(`Uploading and transcribing: ${filePath}`);
      console.log(`Speaker diarization: ${diarize ? 'enabled' : 'disabled'}`);

      const transcript = await client.transcripts.transcribe(config);

      if (transcript.audio_duration) {
        const cost = (transcript.audio_duration / 3600) * ASSEMBLYAI_PRICING.perHour;
        console.log(`   Transcription: ${Math.round(transcript.audio_duration)}s audio → $${cost.toFixed(4)}`);
      }

      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // Include start/end timestamps (milliseconds) for each utterance
      const utterances = (transcript.utterances || []).map(u => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
      }));

      return {
        text: transcript.text,
        utterances,
        audioDuration: transcript.audio_duration,
        id: transcript.id,
      };
    }
  };
}
