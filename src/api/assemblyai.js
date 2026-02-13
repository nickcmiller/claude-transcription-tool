/**
 * AssemblyAI transcription client
 */

import { AssemblyAI } from 'assemblyai';

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

      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      return {
        text: transcript.text,
        utterances: transcript.utterances || [],
        audioDuration: transcript.audio_duration,
        id: transcript.id,
      };
    }
  };
}
