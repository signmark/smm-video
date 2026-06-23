/**
 * FAL.AI animation service — supports both Image-to-Video (I2V) and Text-to-Video (T2V).
 *
 * I2V models (require source image):
 *   wan         — fal-ai/wan/v2.7/image-to-video
 *   kling       — fal-ai/kling-video/v1.6/standard/image-to-video
 *   kling-pro   — fal-ai/kling-video/v1.6/pro/image-to-video
 *   minimax     — fal-ai/minimax/video-01-live/image-to-video
 *   seedance    — fal-ai/bytedance/seedance/v1/lite/image-to-video
 *
 * T2V models (text prompt only, no image needed):
 *   wan-t2v     — fal-ai/wan/v2.7/text-to-video
 *   kling-t2v   — fal-ai/kling-video/v3/standard/text-to-video
 *   kling-pro-t2v — fal-ai/kling-video/v3/pro/text-to-video
 *   luma        — fal-ai/luma-dream-machine/ray-2-flash
 *   seedance-t2v  — fal-ai/bytedance/seedance-1-lite/text-to-video
 *   seedance2-t2v — fal-ai/bytedance/seedance-2.0/text-to-video
 *   veo3          — fal-ai/veo3.1
 *   happy-horse   — fal-ai/alibaba/happy-horse/text-to-video
 */
import fs from 'fs/promises';
import path from 'path';
import type { VideoFormat, AnimationModel } from '../db.js';

const FAL_QUEUE = 'https://queue.fal.run';

const FORMAT_DIMS: Record<VideoFormat, { width: number; height: number }> = {
  '9:16': { width: 480, height: 832 },
  '16:9': { width: 832, height: 480 },
  '1:1':  { width: 576, height: 576 },
};

// Luma uses string aspect ratios; Kling uses the same "9:16" etc.
const LUMA_ASPECT: Record<VideoFormat, string> = {
  '9:16': '9:16',
  '16:9': '16:9',
  '1:1':  '1:1',
};

export function isT2VModel(model: AnimationModel): boolean {
  return ['wan-t2v', 'kling-t2v', 'kling-pro-t2v', 'luma', 'seedance-t2v', 'seedance2-t2v', 'veo3', 'happy-horse', 'chain'].includes(model);
}

// ── FAL queue helpers ──────────────────────────────────────────────────────────

interface FalQueueResponse {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

async function falSubmit(model: string, payload: object, apiKey: string): Promise<FalQueueResponse> {
  const res = await fetch(`${FAL_QUEUE}/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FAL submit ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  if (!data.request_id) throw new Error(`FAL returned no request_id: ${JSON.stringify(data).slice(0, 200)}`);
  return data as FalQueueResponse;
}

async function falPoll(
  queueResp: FalQueueResponse,
  apiKey: string,
  maxWaitMs = 300_000,
  onWait?: (elapsedMs: number) => void,
): Promise<any> {
  const start = Date.now();
  const statusUrl = queueResp.status_url;
  const resultUrl = queueResp.response_url;

  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5_000));

    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`FAL status ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const status = (data.status as string | undefined)?.toUpperCase();

    console.log(`[fal-anim] status=${status} elapsed=${Math.round((Date.now() - start) / 1000)}s`);

    if (status === 'COMPLETED') {
      // Newer FAL models (Kling v2.1, Luma) return result inline in status response
      if (data.output) return data.output;

      // Older models: fetch from response_url
      const result = await fetch(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!result.ok) {
        const errText = await result.text();
        throw new Error(`FAL result ${result.status}: ${errText.slice(0, 200)}`);
      }
      return result.json();
    }

    if (status === 'FAILED') {
      throw new Error(`FAL job FAILED: ${JSON.stringify(data).slice(0, 300)}`);
    }

    onWait?.(Date.now() - start);
  }

  throw new Error('FAL animation timed out');
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Video download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buf);
}

// ── I2V models ─────────────────────────────────────────────────────────────────

async function animateWithWan(imageBuffer: Buffer, prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void): Promise<void> {
  const { width, height } = FORMAT_DIMS[format];
  console.log(`[fal-anim] Wan 2.7 I2V: submitting... (${width}x${height})`);
  const q = await falSubmit('fal-ai/wan/v2.7/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt,
    num_frames: 81,
    width,
    height,
  }, apiKey);
  console.log(`[fal-anim] Wan I2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Wan I2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Wan I2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithKling(imageBuffer: Buffer, prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ? String(clipDuration) : (durationSeconds >= 8 ? '10' : '5');
  console.log(`[fal-anim] Kling v1.6 Standard I2V: submitting... (${duration}s)`);
  const q = await falSubmit('fal-ai/kling-video/v1.6/standard/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt, duration, aspect_ratio: format,
  }, apiKey);
  const result = await falPoll(q, apiKey, 360_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Kling I2V no video URL`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Kling I2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithKlingPro(imageBuffer: Buffer, prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ? String(clipDuration) : (durationSeconds >= 8 ? '10' : '5');
  console.log(`[fal-anim] Kling v1.6 Pro I2V: submitting... (${duration}s)`);
  const q = await falSubmit('fal-ai/kling-video/v1.6/pro/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt, duration, aspect_ratio: format,
  }, apiKey);
  const result = await falPoll(q, apiKey, 420_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Kling Pro I2V no video URL`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Kling Pro I2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithMinimax(imageBuffer: Buffer, prompt: string, outputPath: string, apiKey: string, onWait?: (ms: number) => void): Promise<void> {
  console.log(`[fal-anim] MiniMax I2V: submitting...`);
  const q = await falSubmit('fal-ai/minimax/video-01-live/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt,
  }, apiKey);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`MiniMax I2V no video URL`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] MiniMax I2V clip saved: ${path.basename(outputPath)}`);
}

/** Wraps a raw prompt with Seedance 2.0 structure: Format header + technical tail */
function buildSeedancePrompt(prompt: string, format: VideoFormat): string {
  const TECH_TAIL = 'Stable face throughout. No morphing. No deformation. No flickering. No ghosting. Realistic physics. 4K cinematic.';
  if (prompt.includes(TECH_TAIL)) return prompt; // already structured
  const header = prompt.startsWith('Format:') ? '' : `Format: ${format}\n\n`;
  return `${header}${prompt}\n\n${TECH_TAIL}`;
}

async function animateWithSeedance(imageBuffer: Buffer, prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ?? (durationSeconds >= 8 ? 10 : 5);
  const structuredPrompt = buildSeedancePrompt(prompt, format);
  console.log(`[fal-anim] Seedance I2V: submitting... (${duration}s)`);
  const q = await falSubmit('fal-ai/bytedance/seedance/v1/lite/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt: structuredPrompt, duration, resolution: '720p', aspect_ratio: format,
  }, apiKey);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Seedance I2V no video URL`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Seedance I2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithLtx(imageBuffer: Buffer, prompt: string, format: VideoFormat, outputPath: string, apiKey: string, onWait?: (ms: number) => void): Promise<void> {
  const { width, height } = FORMAT_DIMS[format];
  console.log(`[fal-anim] LTX I2V: submitting... (${width}x${height})`);
  const q = await falSubmit('fal-ai/ltx-video/image-to-video', {
    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
    prompt, width, height, num_frames: 97,
  }, apiKey);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`LTX I2V no video URL`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] LTX I2V clip saved: ${path.basename(outputPath)}`);
}

// ── T2V models ─────────────────────────────────────────────────────────────────

async function animateWithWanT2V(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void): Promise<void> {
  const { width, height } = FORMAT_DIMS[format];
  console.log(`[fal-anim] Wan T2V 1.3B: submitting... (${width}x${height})`);
  const q = await falSubmit('fal-ai/wan/v2.7/text-to-video', {
    prompt,
    num_frames: 81,
    width,
    height,
  }, apiKey);
  console.log(`[fal-anim] Wan T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url ?? result?.videos?.[0]?.url;
  if (!videoUrl) throw new Error(`Wan T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Wan T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithKlingT2V(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ? String(clipDuration) : (durationSeconds >= 8 ? '10' : '5');
  console.log(`[fal-anim] Kling v2 Standard T2V: submitting... (${duration}s)`);
  const q = await falSubmit('fal-ai/kling-video/v3/standard/text-to-video', {
    prompt,
    duration,
    aspect_ratio: format,
  }, apiKey);
  console.log(`[fal-anim] Kling T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 360_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Kling T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Kling T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithKlingProT2V(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ? String(clipDuration) : (durationSeconds >= 8 ? '10' : '5');
  console.log(`[fal-anim] Kling v2 Pro T2V: submitting... (${duration}s)`);
  const q = await falSubmit('fal-ai/kling-video/v3/pro/text-to-video', {
    prompt,
    duration,
    aspect_ratio: format,
  }, apiKey);
  console.log(`[fal-anim] Kling Pro T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 420_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Kling Pro T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Kling Pro T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithLuma(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  // Luma только принимает '5s' или '9s' — не '10s'
  const duration = clipDuration ? (clipDuration >= 9 ? '9s' : '5s') : (durationSeconds >= 7 ? '9s' : '5s');
  const aspect_ratio = LUMA_ASPECT[format];
  console.log(`[fal-anim] Luma Ray 2 Flash T2V: submitting... (${duration}, ${aspect_ratio})`);
  const q = await falSubmit('fal-ai/luma-dream-machine/ray-2-flash', {
    prompt,
    aspect_ratio,
    duration,
    loop: false,
  }, apiKey);
  console.log(`[fal-anim] Luma T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Luma T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Luma T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithSeedanceT2V(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ?? (durationSeconds >= 8 ? 10 : 5);
  const aspect_ratio = format; // seedance accepts '9:16', '16:9', '1:1'
  const structuredPrompt = buildSeedancePrompt(prompt, format);
  console.log(`[fal-anim] Seedance T2V: submitting... (${duration}s, ${aspect_ratio})`);
  const q = await falSubmit('fal-ai/bytedance/seedance-1-lite/text-to-video', {
    prompt: structuredPrompt,
    duration,
    resolution: '720p',
    aspect_ratio,
  }, apiKey);
  console.log(`[fal-anim] Seedance T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Seedance T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Seedance T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithSeedance2T2V(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ?? (durationSeconds >= 8 ? 10 : 5);
  const aspect_ratio = format;
  const structuredPrompt = buildSeedancePrompt(prompt, format);
  console.log(`[fal-anim] Seedance 2.0 T2V: submitting... (${duration}s, ${aspect_ratio})`);
  const q = await falSubmit('fal-ai/bytedance/seedance-2.0/text-to-video', {
    prompt: structuredPrompt,
    duration,
    resolution: '720p',
    aspect_ratio,
  }, apiKey);
  console.log(`[fal-anim] Seedance 2.0 T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Seedance 2.0 T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Seedance 2.0 T2V clip saved: ${path.basename(outputPath)}`);
}

async function animateWithVeo3(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void): Promise<void> {
  const aspect_ratio = format; // '9:16', '16:9', '1:1'
  console.log(`[fal-anim] Veo 3.1 T2V: submitting... (${aspect_ratio})`);
  const q = await falSubmit('fal-ai/veo3.1', {
    prompt,
    aspect_ratio,
  }, apiKey);
  console.log(`[fal-anim] Veo 3.1 request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 600_000, onWait); // до 10 мин
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Veo 3.1 no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Veo 3.1 clip saved: ${path.basename(outputPath)}`);
}

async function animateWithHappyHorse(prompt: string, format: VideoFormat, durationSeconds: number, outputPath: string, apiKey: string, onWait?: (ms: number) => void, clipDuration?: number): Promise<void> {
  const duration = clipDuration ?? (durationSeconds >= 8 ? 10 : 5);
  const aspect_ratio = format;
  console.log(`[fal-anim] Happy Horse T2V: submitting... (${duration}s, ${aspect_ratio})`);
  const q = await falSubmit('fal-ai/alibaba/happy-horse/text-to-video', {
    prompt,
    duration,
    aspect_ratio,
  }, apiKey);
  console.log(`[fal-anim] Happy Horse T2V request_id: ${q.request_id}`);
  const result = await falPoll(q, apiKey, 300_000, onWait);
  const videoUrl = result?.video?.url;
  if (!videoUrl) throw new Error(`Happy Horse T2V no video URL: ${JSON.stringify(result).slice(0, 200)}`);
  await downloadVideo(videoUrl, outputPath);
  console.log(`[fal-anim] Happy Horse T2V clip saved: ${path.basename(outputPath)}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** I2V: animate a source image into a video clip */
export async function animateFrame(params: {
  imageBuffer: Buffer;
  prompt: string;
  format: VideoFormat;
  durationSeconds: number;
  outputPath: string;
  model?: AnimationModel;
  clipDuration?: number;
  onWait?: (elapsedMs: number) => void;
  onFallback?: (fromModel: string, toModel: string, reason: string) => Promise<void>;
}): Promise<void> {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) throw new Error('NO_FAL_KEY');

  const { imageBuffer, prompt, format, durationSeconds, outputPath, model = 'wan', clipDuration, onWait, onFallback } = params;

  const primary = async () => {
    switch (model) {
      case 'wan':       return animateWithWan(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait);
      case 'kling':     return animateWithKling(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'kling-pro': return animateWithKlingPro(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'minimax':   return animateWithMinimax(imageBuffer, prompt, outputPath, apiKey, onWait);
      case 'seedance':  return animateWithSeedance(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      default: throw new Error(`Model ${model} is T2V, use animateText() instead`);
    }
  };

  let primaryError: string | null = null;
  try {
    await primary();
    return;
  } catch (primaryErr: any) {
    primaryError = primaryErr.message;
    console.warn(`[fal-anim] ${model} I2V failed: ${primaryErr.message} — trying fallbacks`);
  }

  const fallbackDefs: Array<[string, () => Promise<void>]> = [
    ['wan',     () => animateWithWan(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait)],
    ['seedance',() => animateWithSeedance(imageBuffer, prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration)],
    ['ltx',     () => animateWithLtx(imageBuffer, prompt, format, outputPath, apiKey, onWait)],
  ].filter(([name]) => name !== model) as Array<[string, () => Promise<void>]>;

  for (const [fallbackName, fallbackFn] of fallbackDefs) {
    try {
      if (onFallback) await onFallback(model, fallbackName, primaryError ?? 'unknown error');
      await fallbackFn();
      return;
    } catch (err: any) {
      console.warn(`[fal-anim] Fallback ${fallbackName} failed: ${err.message}`);
    }
  }

  throw new Error(`All I2V animation models failed (primary: ${model}, error: ${primaryError})`);
}

/** T2V: generate a video clip from text prompt only (no source image) */
export async function animateText(params: {
  prompt: string;
  format: VideoFormat;
  durationSeconds: number;
  outputPath: string;
  model: AnimationModel;
  clipDuration?: number;
  onWait?: (elapsedMs: number) => void;
}): Promise<void> {
  const apiKey = process.env.FAL_AI_API_KEY;
  if (!apiKey) throw new Error('NO_FAL_KEY');

  const { prompt, format, durationSeconds, outputPath, model, clipDuration, onWait } = params;

  const primary = async () => {
    switch (model) {
      case 'wan-t2v':       return animateWithWanT2V(prompt, format, durationSeconds, outputPath, apiKey, onWait);
      case 'kling-t2v':     return animateWithKlingT2V(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'kling-pro-t2v': return animateWithKlingProT2V(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'luma':          return animateWithLuma(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'seedance-t2v':  return animateWithSeedanceT2V(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'seedance2-t2v': return animateWithSeedance2T2V(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      case 'veo3':          return animateWithVeo3(prompt, format, durationSeconds, outputPath, apiKey, onWait);
      case 'happy-horse':   return animateWithHappyHorse(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration);
      default: throw new Error(`Model ${model} is I2V, use animateFrame() instead`);
    }
  };

  try {
    await primary();
    return;
  } catch (primaryErr: any) {
    console.warn(`[fal-anim] ${model} T2V failed: ${primaryErr.message} — trying fallback`);
  }

  // T2V fallback chain: Wan T2V 1.3B → Luma (skip the one that already failed)
  const fallbacks: Array<[string, () => Promise<void>]> = [
    ['wan-t2v', () => animateWithWanT2V(prompt, format, durationSeconds, outputPath, apiKey, onWait)],
    ['luma',    () => animateWithLuma(prompt, format, durationSeconds, outputPath, apiKey, onWait, clipDuration)],
  ].filter(([name]) => name !== model) as [string, () => Promise<void>][];

  for (const [name, fn] of fallbacks) {
    try {
      console.log(`[fal-anim] T2V fallback: trying ${name}...`);
      await fn();
      return;
    } catch (err: any) {
      console.warn(`[fal-anim] T2V fallback ${name} failed: ${err.message}`);
    }
  }

  throw new Error('All T2V animation models failed');
}
