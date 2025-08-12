import 'dotenv/config';

export interface SynthesizeOptions {
  voiceId?: string;
  modelId?: string;
  optimizeStreamingLatency?: number;
}

/**
 * Synthesize speech using ElevenLabs streaming endpoint.
 * Returns a web ReadableStream (Node 22 global fetch Response.body is a web stream).
 */
export async function synthesizeSpeech(
  text: string,
  options: SynthesizeOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // default Rachel
  const modelId = options.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2';
  const optimizeLatency = options.optimizeStreamingLatency ?? 4;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      optimize_streaming_latency: optimizeLatency,
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
      },
    }),
  });

  if (!resp.ok || !resp.body) {
    const msg = await safeReadText(resp);
    throw new Error(`ElevenLabs TTS failed: ${resp.status} ${resp.statusText} ${msg ?? ''}`);
  }

  return resp.body as ReadableStream<Uint8Array>;
}

async function safeReadText(resp: Response): Promise<string | null> {
  try {
    return await resp.text();
  } catch {
    return null;
  }
}

