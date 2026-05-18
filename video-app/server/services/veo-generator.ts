/**
 * Veo 3 video clip generation via Gemini API.
 * Generates one short video clip per scene, polls until ready, saves as mp4.
 */
import fs from 'fs/promises';
import path from 'path';
import type { VideoFormat } from '../db.js';

const ASPECT_RATIO: Record<VideoFormat, string> = {
  '9:16': '9:16',
  '16:9': '16:9',
  '1:1': '1:1',
};

function getApiBase(): string {
  const proxyUrl = process.env.GEMINI_PROXY_URL;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}`;
  }
  return 'https://generativelanguage.googleapis.com';
}

async function pollOperation(
  operationName: string,
  apiKey: string,
  maxWaitMs = 300_000,
  onWait?: (elapsedMs: number) => void
): Promise<any> {
  const base = getApiBase();
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 10_000 : 5_000));
    attempt++;

    const elapsed = Date.now() - start;
    onWait?.(elapsed);

    const res = await fetch(`${base}/v1beta/${operationName}?key=${apiKey}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Veo poll error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    if (data.done) return data;

    console.log(`[veo] Still generating... (${Math.round(elapsed / 1000)}s elapsed)`);
  }

  throw new Error('Veo generation timed out after 5 minutes');
}

function extractVideoBase64(result: any): string | null {
  // Try all known response shapes
  const r = result.response;
  if (!r) return null;

  // Shape 1: response.videos[0].bytesBase64Encoded
  if (r.videos?.[0]?.bytesBase64Encoded) return r.videos[0].bytesBase64Encoded;

  // Shape 2: response.generateVideoResponse.generatedSamples[0].video.bytesBase64Encoded
  const samples = r.generateVideoResponse?.generatedSamples;
  if (samples?.[0]?.video?.bytesBase64Encoded) return samples[0].video.bytesBase64Encoded;

  // Shape 3: response.predictions[0].bytesBase64Encoded
  if (r.predictions?.[0]?.bytesBase64Encoded) return r.predictions[0].bytesBase64Encoded;

  console.warn('[veo] Unknown response shape:', JSON.stringify(r).slice(0, 300));
  return null;
}

export async function generateVeoClip(params: {
  prompt: string;
  format: VideoFormat;
  durationSeconds: number;
  outputPath: string;
  /** Optional starting frame for image-to-video generation */
  imageBuffer?: Buffer;
  onWait?: (elapsedMs: number) => void;
}): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('NO_GEMINI_KEY');

  const base = getApiBase();
  const model = 'veo-3.0-fast-generate-001';
  const clipDuration = Math.min(8, Math.max(5, Math.round(params.durationSeconds)));
  const mode = params.imageBuffer ? 'image-to-video' : 'text-to-video';

  const url = `${base}/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  console.log(`[veo] ${mode}: "${params.prompt.slice(0, 60)}..." (${clipDuration}s, ${params.format})`);

  const instance: Record<string, any> = { prompt: params.prompt };
  if (params.imageBuffer) {
    instance.image = {
      bytesBase64Encoded: params.imageBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: ASPECT_RATIO[params.format],
        durationSeconds: clipDuration,
        sampleCount: 1,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Veo start error ${res.status}: ${text.slice(0, 300)}`);
  }

  const { name: operationName } = await res.json() as { name: string };
  console.log(`[veo] Operation: ${operationName}`);

  const result = await pollOperation(operationName, apiKey, 300_000, params.onWait);

  const videoBase64 = extractVideoBase64(result);
  if (!videoBase64) throw new Error('Veo returned no video data');

  await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
  await fs.writeFile(params.outputPath, Buffer.from(videoBase64, 'base64'));
  console.log(`[veo] Clip saved: ${path.basename(params.outputPath)}`);
}
