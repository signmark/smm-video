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
  if (format === '9:16') return { width: 720, height: 1280 };
  if (format === '16:9') return { width: 1280, height: 720 };
  return { width: 720, height: 720 };
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
    ffmpeg(inputPath)
      .inputOptions(['-t', String(durationSeconds)])
      .videoFilters([
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
      ])
      .outputOptions(['-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
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
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not set — add it to Directus global_api_keys');

  const orientation = getOrientation(format);
  const { width, height } = getTargetSize(format);

  console.log(`[stock] Searching Pexels: "${query.slice(0, 60)}" orientation=${orientation} dur=${durationSeconds}s`);

  const video = await findPexelsVideo(query, orientation, apiKey, durationSeconds);

  const videoFile = (video.video_files as any[])
    .filter((f: any) => f.link && (f.quality === 'hd' || f.quality === 'sd'))
    .sort((a: any, b: any) => b.width - a.width)[0];

  if (!videoFile) throw new Error(`No downloadable video file for query: ${query}`);

  console.log(`[stock] Downloading ${videoFile.quality} ${videoFile.width}x${videoFile.height}: ${videoFile.link.slice(0, 80)}`);

  const tempPath = outputPath + '.tmp.mp4';
  try {
    await downloadFile(videoFile.link, tempPath);
    await trimAndScale(tempPath, outputPath, durationSeconds, width, height);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }

  console.log(`[stock] Clip ready: ${outputPath}`);
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

// ── Stock photo search (Pexels Photos API) ───────────────────────────────────
// Downloads a stock photo and resizes it to target format dimensions.
// Saved as JPEG — can be used directly as I2V source image (variant 0).

export async function searchAndDownloadStockPhoto(options: {
  query: string;
  outputPath: string;
  format: VideoFormat;
}): Promise<void> {
  const { query, outputPath, format } = options;
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not set');

  const orientation = getOrientation(format);
  const { width, height } = getTargetSize(format);

  console.log(`[stock-photo] Searching Pexels Photos: "${query.slice(0, 60)}" orientation=${orientation}`);

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
  if (!photos.length) throw new Error(`No Pexels photos found for: "${query}"`);

  const photo = photos[0];
  const photoUrl = photo.src?.large2x || photo.src?.large || photo.src?.original;
  if (!photoUrl) throw new Error('No photo URL in Pexels response');

  console.log(`[stock-photo] Downloading photo id=${photo.id}`);
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
  const resp = await fetch(searchUrl, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000) });
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
