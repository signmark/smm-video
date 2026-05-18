import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { VideoFormat } from '../db.js';

const FORMAT_OUTPUT: Record<VideoFormat, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
};

const HF_SIZES: Record<VideoFormat, { width: number; height: number }> = {
  '9:16': { width: 576, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  '1:1': { width: 1024, height: 1024 },
};

const FAL_IMAGE_SIZE: Record<VideoFormat, string> = {
  '9:16': 'portrait_9_16',
  '16:9': 'landscape_16_9',
  '1:1': 'square',
};

const IMAGEN_ASPECT: Record<VideoFormat, string> = {
  '9:16': '9:16',
  '16:9': '16:9',
  '1:1': '1:1',
};

// gpt-image-1 поддерживает: 1024x1024, 1024x1536, 1536x1024
const GPT_IMAGE_SIZE: Record<VideoFormat, string> = {
  '9:16': '1024x1536',
  '16:9': '1536x1024',
  '1:1': '1024x1024',
};

function getGeminiBase(): string {
  const proxyUrl = process.env.GEMINI_PROXY_URL;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}`;
  }
  return 'https://generativelanguage.googleapis.com';
}

// ── 0. GPT Image 1 (OpenAI) ───────────────────────────────────────────────────

async function fetchFromGptImage(prompt: string, format: VideoFormat): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('NO_OPENAI_KEY');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: GPT_IMAGE_SIZE[format],
      output_format: 'jpeg',
      quality: 'high',
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GPT-Image-1 ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('GPT-Image-1 returned no image data');

  return Buffer.from(b64, 'base64');
}

// ── 1. Nano Banana (Gemini image models) ─────────────────────────────────────
// Tries Nano Banana 2 (gemini-3.1-flash-image-preview) first,
// falls back to Nano Banana original (gemini-2.5-flash-image).

async function fetchFromNanoBanana(prompt: string, format: VideoFormat, model: string): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('NO_GEMINI_KEY');

  const base = getGeminiBase();
  const url = `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const aspectHint =
    format === '9:16' ? 'vertical portrait orientation 9:16, tall' :
    format === '16:9' ? 'horizontal landscape orientation 16:9, wide' :
    'square composition 1:1';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}. ${aspectHint}. No text, no watermarks.` }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NanoBanana(${model}) ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error(`NanoBanana(${model}) returned no image`);

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function fetchFromGeminiFlash(prompt: string, format: VideoFormat): Promise<Buffer> {
  // Try Nano Banana 2 first, fall back to Nano Banana original
  for (const model of ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image']) {
    try {
      const buf = await fetchFromNanoBanana(prompt, format, model);
      console.log(`[image-gen] NanoBanana model used: ${model}`);
      return buf;
    } catch (err: any) {
      console.warn(`[image-gen] ${model} failed: ${err.message}`);
    }
  }
  throw new Error('All NanoBanana models failed');
}

// ── 2. Imagen 4 (secondary — highest quality, same key) ───────────────────────

async function fetchFromImagen4(prompt: string, format: VideoFormat): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('NO_GEMINI_KEY');

  const base = getGeminiBase();
  const url = `${base}/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: IMAGEN_ASPECT[format],
        outputMimeType: 'image/jpeg',
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Imagen4 ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const b64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen4 returned no image data');

  return Buffer.from(b64, 'base64');
}

// ── 3. HuggingFace FLUX.1-schnell (free fallback) ────────────────────────────

async function fetchFromHuggingFace(prompt: string, format: VideoFormat): Promise<Buffer> {
  const token = process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN;
  if (!token) throw new Error('NO_HF_TOKEN');

  const size = HF_SIZES[format];

  const endpoints = [
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
  ];

  let lastErr = '';
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { num_inference_steps: 4, width: size.width, height: size.height },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (res.status === 503) {
      const body = (await res.json()) as any;
      const wait = Math.min((body.estimated_time || 20) * 1000, 30000);
      console.log(`[image-gen] HF model loading, waiting ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-wait-for-model': 'true' },
        body: JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: 4, width: size.width, height: size.height } }),
        signal: AbortSignal.timeout(45000),
      });
      if (res2.ok) return Buffer.from(await res2.arrayBuffer());
      lastErr = `HF ${res2.status}: ${(await res2.text()).slice(0, 200)}`;
      continue;
    }

    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
      const json = await res.json() as any;
      if (Array.isArray(json) && json[0]?.generated_image) {
        const imgRes = await fetch(json[0].generated_image);
        return Buffer.from(await imgRes.arrayBuffer());
      }
      lastErr = `HF unexpected response: ${JSON.stringify(json).slice(0, 200)}`;
      continue;
    }

    lastErr = `HF ${res.status}: ${(await res.text()).slice(0, 200)}`;
  }

  throw new Error(lastErr || 'HuggingFace failed');
}

// ── 4. FAL.AI FLUX schnell (paid fallback) ────────────────────────────────────

async function fetchFromFal(prompt: string, format: VideoFormat): Promise<Buffer> {
  const key = process.env.FAL_AI_API_KEY;
  if (!key) throw new Error('NO_FAL_KEY');

  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_size: FAL_IMAGE_SIZE[format],
      num_inference_steps: 4,
      num_images: 1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAL ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { images: Array<{ url: string }> };
  const imageUrl = json.images?.[0]?.url;
  if (!imageUrl) throw new Error('FAL returned no image URL');

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!imgRes.ok) throw new Error(`FAL image download failed: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ── 5. Placeholder (last resort) ──────────────────────────────────────────────

async function generatePlaceholder(text: string, format: VideoFormat): Promise<Buffer> {
  const { w, h } = FORMAT_OUTPUT[format];
  const colors = ['#1a1a2e', '#16213e', '#0f3460', '#533483', '#2d6a4f', '#1b4332'];
  const bg = colors[Math.floor(Math.random() * colors.length)];
  const fontSize = Math.round(w * 0.04);
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > 20) { lines.push(line.trim()); line = word + ' '; }
    else line += word + ' ';
  }
  if (line.trim()) lines.push(line.trim());

  const lineHeight = fontSize * 1.4;
  const totalTextH = lines.length * lineHeight;
  const startY = h / 2 - totalTextH / 2;
  const textElements = lines
    .map((l, i) => `<text x="50%" y="${startY + i * lineHeight}" fill="#ffffff" font-size="${fontSize}" font-family="Arial,sans-serif" text-anchor="middle" dominant-baseline="middle">${l}</text>`)
    .join('');

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect x="4%" y="4%" width="92%" height="92%" rx="24" fill="${bg}" opacity="0.7" stroke="#ffffff22" stroke-width="2"/>
    ${textElements}
    <text x="50%" y="${h * 0.9}" fill="#ffffff44" font-size="${Math.round(fontSize * 0.6)}" font-family="Arial,sans-serif" text-anchor="middle">AI Video Generator</text>
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

// ── White-background removal via pixel threshold ───────────────────────────────
// Simple but effective for AI-generated subjects on solid white backgrounds.

async function removeWhiteBackground(buf: Buffer, threshold = 242): Promise<Buffer> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i + 3] = 0; // transparent
    } else if (r >= threshold - 15 && g >= threshold - 15 && b >= threshold - 15) {
      // Soft edge: partial transparency for anti-aliasing
      const avg = (r + g + b) / 3;
      data[i + 3] = Math.round(((threshold - avg) / 15) * 255);
    }
  }

  return sharp(Buffer.from(data), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

// ── Layered image: background + subject composite ─────────────────────────────

export async function generateLayeredImage(params: {
  backgroundPrompt: string;
  subjectPrompt: string;
  format: VideoFormat;
  outputPath: string;
  sceneText?: string;
}): Promise<void> {
  const { backgroundPrompt, subjectPrompt, format, outputPath, sceneText } = params;
  const { w, h } = FORMAT_OUTPUT[format];
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Generate both layers in parallel
  const [bgBuf, subjectBuf] = await Promise.all([
    (async () => {
      const tmp = outputPath.replace(/\.jpg$/, '_bg_raw.jpg');
      await generateImage({ prompt: backgroundPrompt, format, outputPath: tmp, sceneText });
      const buf = await fs.readFile(tmp);
      await fs.unlink(tmp).catch(() => {});
      return buf;
    })(),
    (async () => {
      // Subject generated slightly smaller format for isolation quality
      const subjectFormatSize = format === '9:16' ? { w: 768, h: 1024 } : format === '16:9' ? { w: 1024, h: 768 } : { w: 1024, h: 1024 };
      const isolatedPrompt = `${subjectPrompt}, isolated on pure white background, centered, clean cutout, studio lighting, no shadows on background`;
      let buf: Buffer | undefined;

      // Try providers in order until one works
      for (const fn of [
        () => fetchFromGptImage(isolatedPrompt, '1:1'),
        () => fetchFromGeminiFlash(isolatedPrompt, '1:1'),
        () => fetchFromImagen4(isolatedPrompt, '1:1'),
        () => fetchFromHuggingFace(isolatedPrompt, '1:1'),
        () => fetchFromFal(isolatedPrompt, '1:1'),
      ]) {
        try {
          buf = await fn();
          break;
        } catch {
          // try next provider
        }
      }
      if (!buf) buf = await generatePlaceholder(sceneText || subjectPrompt, '1:1');
      return buf;
    })(),
  ]);

  // Resize background to full output size
  const bgResized = await sharp(bgBuf).resize(w, h, { fit: 'cover', position: 'center' }).toBuffer();

  // Remove white background from subject
  const subjectClean = await removeWhiteBackground(subjectBuf);

  // Scale subject to fit within 72% of the shorter dimension, centered
  const subjectMaxW = Math.round(w * 0.72);
  const subjectMaxH = Math.round(h * 0.72);
  const subjectResized = await sharp(subjectClean)
    .resize(subjectMaxW, subjectMaxH, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  // Get actual subject dimensions after resize
  const { width: sw, height: sh } = await sharp(subjectResized).metadata();
  const left = Math.round((w - (sw ?? subjectMaxW)) / 2);
  const top = Math.round((h - (sh ?? subjectMaxH)) / 2);

  // Composite: background + subject
  await sharp(bgResized)
    .composite([{ input: subjectResized, left, top, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  console.log(`[image-gen] Layered composite: bg=${path.basename(outputPath)} (${w}×${h}), subject at ${left},${top} (${sw}×${sh})`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateImage(params: {
  prompt: string;
  format: VideoFormat;
  outputPath: string;
  sceneText?: string;
}): Promise<void> {
  const { prompt, format, outputPath, sceneText } = params;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const { w, h } = FORMAT_OUTPUT[format];
  let imageBuffer: Buffer;
  let source = 'placeholder';

  // 0. GPT Image 2 — best quality for I2V
  try {
    imageBuffer = await fetchFromGptImage(prompt, format);
    source = 'GPT-Image-2';
  } catch (err0: any) {
    if (err0.message !== 'NO_OPENAI_KEY') {
      console.warn(`[image-gen] GPT-Image-2 failed: ${err0.message} — trying GeminiFlash`);
    }

    // 1. Gemini Flash image gen — fast, free quota, same key
    try {
      imageBuffer = await fetchFromGeminiFlash(prompt, format);
      source = 'GeminiFlash';
    } catch (err1: any) {
      if (err1.message !== 'NO_GEMINI_KEY') {
        console.warn(`[image-gen] GeminiFlash failed: ${err1.message} — trying Imagen4`);
      }

      // 2. Imagen 4 — highest quality, same key
      try {
        imageBuffer = await fetchFromImagen4(prompt, format);
        source = 'Imagen4';
      } catch (err2: any) {
        if (err2.message !== 'NO_GEMINI_KEY') {
          console.warn(`[image-gen] Imagen4 failed: ${err2.message} — trying HuggingFace`);
        }

        // 3. HuggingFace FLUX.1-schnell — free
        try {
          imageBuffer = await fetchFromHuggingFace(prompt, format);
          source = 'HuggingFace';
        } catch (err3: any) {
          if (err3.message !== 'NO_HF_TOKEN') {
            console.warn(`[image-gen] HF failed: ${err3.message} — trying FAL`);
          }

          // 4. FAL FLUX schnell — paid fallback
          try {
            imageBuffer = await fetchFromFal(prompt, format);
            source = 'FAL';
          } catch (err4: any) {
            if (err4.message !== 'NO_FAL_KEY') {
              console.warn(`[image-gen] FAL failed: ${err4.message} — using placeholder`);
            }
            imageBuffer = await generatePlaceholder(sceneText || prompt, format);
          }
        }
      }
    }
  }

  await sharp(imageBuffer!)
    .resize(w, h, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  console.log(`[image-gen] ${source}: ${path.basename(outputPath)}`);
}
