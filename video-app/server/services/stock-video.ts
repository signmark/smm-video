import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import type { VideoFormat } from '../db.js';

function resolveFfmpegPath(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return ffmpegInstaller.path;
}
const FFMPEG_BIN = resolveFfmpegPath();
ffmpeg.setFfmpegPath(FFMPEG_BIN);

function getOrientation(format: VideoFormat): string {
  if (format === '9:16') return 'portrait';
  return 'landscape';
}

function getTargetSize(format: VideoFormat): { width: number; height: number } {
  // Match FORMAT_SIZES used by burnSubtitles (1080p canvas) so that all clips
  // enter assembleFromClips at a consistent high resolution and subtitle
  // coordinates map correctly.
  if (format === '9:16') return { width: 1080, height: 1920 };
  if (format === '16:9') return { width: 1920, height: 1080 };
  return { width: 1080, height: 1080 };
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${url}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function trimAndScale(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  width: number,
  height: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // -stream_loop -1 loops the clip if it is shorter than durationSeconds,
    // guaranteeing the output is exactly durationSeconds regardless of source length.
    ffmpeg(inputPath)
      .inputOptions(['-stream_loop', '-1', '-t', String(durationSeconds)])
      .videoFilters([
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
      ])
      .outputOptions(['-t', String(durationSeconds), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

export interface StockClipOptions {
  query: string;
  outputPath: string;
  durationSeconds: number;
  format: VideoFormat;
}

export async function searchAndDownloadStockClip(options: StockClipOptions): Promise<void> {
  const { query, outputPath, durationSeconds, format } = options;
  const orientation = getOrientation(format);
  const { width, height } = getTargetSize(format);

  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pexelsKey && !pixabayKey) {
    throw new Error('No stock video API key set (PEXELS_API_KEY / PIXABAY_API_KEY)');
  }

  const tempPath = outputPath + '.tmp.mp4';
  async function fetchAndPrepare(link: string, source: string): Promise<void> {
    try {
      await downloadFile(link, tempPath);
      await trimAndScale(tempPath, outputPath, durationSeconds, width, height);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
    console.log(`[stock] Clip ready (${source}): ${outputPath}`);
  }

  // 1) Pexels (primary)
  if (pexelsKey) {
    try {
      console.log(`[stock] Searching Pexels: "${query.slice(0, 60)}" orientation=${orientation} dur=${durationSeconds}s`);
      const video = await findPexelsVideo(query, orientation, pexelsKey, durationSeconds);
      const videoFile = (video.video_files as any[])
        .filter((f: any) => f.link && (f.quality === 'hd' || f.quality === 'sd'))
        .sort((a: any, b: any) => b.width - a.width)[0];
      if (videoFile) {
        console.log(`[stock] Downloading ${videoFile.quality} ${videoFile.width}x${videoFile.height}`);
        await fetchAndPrepare(videoFile.link, 'Pexels');
        return;
      }
    } catch (err: any) {
      console.log(`[stock] Pexels miss for "${query.slice(0, 40)}": ${err.message}`);
    }
  }

  // 2) Pixabay (fallback) — activates when PIXABAY_API_KEY is present
  if (pixabayKey) {
    try {
      console.log(`[stock] Searching Pixabay: "${query.slice(0, 60)}" orientation=${orientation}`);
      const link = await findPixabayVideo(query, orientation, pixabayKey);
      if (link) {
        await fetchAndPrepare(link, 'Pixabay');
        return;
      }
    } catch (err: any) {
      console.log(`[stock] Pixabay miss for "${query.slice(0, 40)}": ${err.message}`);
    }
  }

  throw new Error(`No stock video found for: "${query}"`);
}

async function findPexelsVideo(
  query: string,
  orientation: string,
  apiKey: string,
  durationSeconds: number,
): Promise<any> {
  const minDur = Math.max(2, durationSeconds - 2);
  const maxDur = durationSeconds + 15;

  const urlWithDur = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=10&min_duration=${minDur}&max_duration=${maxDur}`;
  const resp1 = await fetch(urlWithDur, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) });
  if (resp1.ok) {
    const data = await resp1.json() as any;
    if (data.videos?.length) return data.videos[0];
  }

  const urlFallback = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=10`;
  const resp2 = await fetch(urlFallback, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) });
  if (!resp2.ok) throw new Error(`Pexels API error: ${resp2.status}`);
  const data2 = await resp2.json() as any;

  if (!data2.videos?.length) {
    const words = query.split(' ').slice(0, 3).join(' ');
    if (words !== query) {
      const urlShort = `https://api.pexels.com/videos/search?query=${encodeURIComponent(words)}&orientation=${orientation}&per_page=10`;
      const resp3 = await fetch(urlShort, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) });
      if (resp3.ok) {
        const data3 = await resp3.json() as any;
        if (data3.videos?.length) return data3.videos[0];
      }
    }
    throw new Error(`No Pexels videos found for: "${query}"`);
  }
  return data2.videos[0];
}

// ── Pixabay video search (fallback source) ───────────────────────────────────
// Pixabay's video API has no orientation param, so we filter by aspect ratio.
async function findPixabayVideo(query: string, orientation: string, apiKey: string): Promise<string | null> {
  async function search(q: string): Promise<any[]> {
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Pixabay API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.hits || [];
  }

  let hits = await search(query);
  if (!hits.length) {
    const words = query.split(' ').slice(0, 3).join(' ');
    if (words !== query) hits = await search(words);
  }
  if (!hits.length) return null;

  const portrait = orientation === 'portrait';
  const candidates = hits
    .map((h: any) => {
      const v = h.videos?.large || h.videos?.medium || h.videos?.small || h.videos?.tiny;
      return v?.url ? { url: v.url as string, w: v.width as number, h: v.height as number } : null;
    })
    .filter(Boolean) as { url: string; w: number; h: number }[];
  if (!candidates.length) return null;

  // Prefer a clip whose orientation matches the target format.
  const match = candidates.find((c) => (portrait ? c.h >= c.w : c.w >= c.h));
  return (match || candidates[0]).url;
}

// ── Stock photo helpers ──────────────────────────────────────────────────────
async function findPexelsPhoto(query: string, orientation: string, apiKey: string): Promise<string | null> {
  async function fetchPhotos(q: string): Promise<any[]> {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=${orientation}&per_page=5`;
    const resp = await fetch(url, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Pexels Photos API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.photos || [];
  }
  let photos = await fetchPhotos(query);
  if (!photos.length) {
    const words = query.split(' ').slice(0, 3).join(' ');
    if (words !== query) photos = await fetchPhotos(words);
  }
  if (!photos.length) return null;
  const photo = photos[0];
  return photo.src?.large2x || photo.src?.large || photo.src?.original || null;
}

async function findPixabayPhoto(query: string, orientation: string, apiKey: string): Promise<string | null> {
  async function search(q: string): Promise<any[]> {
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(q)}&image_type=photo&per_page=20&safesearch=true`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`Pixabay Photos API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.hits || [];
  }
  let hits = await search(query);
  if (!hits.length) {
    const words = query.split(' ').slice(0, 3).join(' ');
    if (words !== query) hits = await search(words);
  }
  if (!hits.length) return null;

  const portrait = orientation === 'portrait';
  const match = hits.find((h: any) => (portrait ? h.imageHeight >= h.imageWidth : h.imageWidth >= h.imageHeight));
  const chosen = match || hits[0];
  return chosen.largeImageURL || chosen.fullHDURL || chosen.webformatURL || null;
}

// ── Stock photo search (Pexels Photos API) ───────────────────────────────────
// Downloads a stock photo and resizes it to target format dimensions.
// Saved as JPEG — can be used directly as I2V source image (variant 0).

export async function searchAndDownloadStockPhoto(options: {
  query: string;
  outputPath: string;
  format: VideoFormat;
}): Promise<void> {
  const { query, outputPath, format } = options;
  const orientation = getOrientation(format);
  const { width, height } = getTargetSize(format);

  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (!pexelsKey && !pixabayKey) {
    throw new Error('No stock photo API key set (PEXELS_API_KEY / PIXABAY_API_KEY)');
  }

  let photoUrl: string | null = null;

  // 1) Pexels (primary)
  if (pexelsKey) {
    try {
      console.log(`[stock-photo] Searching Pexels Photos: "${query.slice(0, 60)}" orientation=${orientation}`);
      photoUrl = await findPexelsPhoto(query, orientation, pexelsKey);
    } catch (err: any) {
      console.log(`[stock-photo] Pexels miss for "${query.slice(0, 40)}": ${err.message}`);
    }
  }

  // 2) Pixabay (fallback)
  if (!photoUrl && pixabayKey) {
    try {
      console.log(`[stock-photo] Searching Pixabay Photos: "${query.slice(0, 60)}" orientation=${orientation}`);
      photoUrl = await findPixabayPhoto(query, orientation, pixabayKey);
    } catch (err: any) {
      console.log(`[stock-photo] Pixabay miss for "${query.slice(0, 40)}": ${err.message}`);
    }
  }

  if (!photoUrl) throw new Error(`No stock photo found for: "${query}"`);

  console.log(`[stock-photo] Downloading photo: ${photoUrl.slice(0, 80)}`);
  const resp = await fetch(photoUrl, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`Photo download failed: ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.mkdir(outputPath.replace(/\/[^/]+$/, ''), { recursive: true });
  await sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  console.log(`[stock-photo] Photo ready: ${outputPath}`);
}

export async function searchStockVideos(query: string, format: VideoFormat, limit = 6): Promise<Array<{
  id: number;
  duration: number;
  thumbnail: string;
  url: string;
  width: number;
  height: number;
}>> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not set');

  const orientation = getOrientation(format);
  const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${limit}`;
  const resp = await fetch(searchUrl, { headers: { Authorization: apiKey! }, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Pexels API error: ${resp.status}`);
  const data = await resp.json() as any;

  return (data.videos || []).map((v: any) => ({
    id: v.id,
    duration: v.duration,
    thumbnail: v.image,
    url: `https://www.pexels.com/video/${v.id}/`,
    width: v.width,
    height: v.height,
  }));
}
