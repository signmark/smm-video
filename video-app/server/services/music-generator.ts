/**
 * Background music for generated videos.
 *
 * Sources (in priority order):
 *  1. Jamendo — royalty-free stock tracks; needs JAMENDO_CLIENT_ID in Directus.
 *  2. FAL.AI Stable Audio — AI-generated music; uses existing FAL_AI_API_KEY.
 *  3. Skip silently — music is optional, video is still produced.
 */
import fs from 'fs/promises';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const execFileAsync = promisify(execFile);

function resolveFfmpegPath(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return ffmpegInstaller.path;
}
const FFMPEG = resolveFfmpegPath();

// ── Style catalogue ───────────────────────────────────────────────────────────

export interface MusicStyleDef {
  value: string;
  label: string;
  emoji: string;
  desc: string;
  jamendoTags: string;   // fuzzytags parameter for Jamendo API
  falPrompt: string;     // prompt for FAL Stable Audio
}

export const MUSIC_STYLES: MusicStyleDef[] = [
  {
    value: 'none',
    label: 'Без музыки',
    emoji: '🔇',
    desc: 'Только голос, без фона',
    jamendoTags: '',
    falPrompt: '',
  },
  {
    value: 'ambient',
    label: 'Эмбиент',
    emoji: '🌊',
    desc: 'Спокойный атмосферный фон',
    jamendoTags: 'ambient',
    falPrompt: 'calm ambient background music, atmospheric pads, no vocals, soft instrumental, suitable for voice-over narration, relaxing',
  },
  {
    value: 'cinematic',
    label: 'Кинематографическая',
    emoji: '🎬',
    desc: 'Эпическая оркестровая',
    jamendoTags: 'cinematic',
    falPrompt: 'epic cinematic orchestral background music, dramatic strings, no vocals, film score, inspiring and emotional',
  },
  {
    value: 'corporate',
    label: 'Корпоративная',
    emoji: '💼',
    desc: 'Мотивирующая деловая',
    jamendoTags: 'corporate',
    falPrompt: 'corporate motivational background music, professional, upbeat, positive, no vocals, suitable for business presentation',
  },
  {
    value: 'electronic',
    label: 'Электронная',
    emoji: '⚡',
    desc: 'Современная динамичная',
    jamendoTags: 'electronic',
    falPrompt: 'upbeat electronic background music, modern synths, energetic, no vocals, suitable for technology and lifestyle content',
  },
  {
    value: 'acoustic',
    label: 'Акустическая',
    emoji: '🎸',
    desc: 'Лёгкая гитарная',
    jamendoTags: 'acoustic',
    falPrompt: 'light acoustic guitar background music, warm and cozy, no vocals, folk-inspired, gentle and pleasant',
  },
  {
    value: 'jazz',
    label: 'Джаз',
    emoji: '🎷',
    desc: 'Расслабленный джазовый фон',
    jamendoTags: 'jazz',
    falPrompt: 'relaxed jazz background music, soft piano and bass, no vocals, smooth and sophisticated',
  },
];

export function getMusicStyle(value?: string): MusicStyleDef {
  return MUSIC_STYLES.find((s) => s.value === value) ?? MUSIC_STYLES[1]; // default ambient
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loopToFit(inputPath: string, outputPath: string, targetSec: number): Promise<void> {
  await execFileAsync(FFMPEG, [
    '-y',
    '-stream_loop', '-1',
    '-i', inputPath,
    '-t', String(targetSec),
    '-codec:a', 'libmp3lame', '-q:a', '4',
    outputPath,
  ]);
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`Download failed ${resp.status}: ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

// ── Source 1: Jamendo stock music ─────────────────────────────────────────────

async function fetchJamendoTrack(style: MusicStyleDef, targetSec: number, outputPath: string): Promise<string | null> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId || !style.jamendoTags) return null;

  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('fuzzytags', style.jamendoTags);
  url.searchParams.set('audiodlformat', 'mp32');
  url.searchParams.set('boost', 'popularity_total');
  url.searchParams.set('order', 'popularity_total_desc');
  // prefer tracks at least as long as the target so looping is seamless
  url.searchParams.set('durationbetween', `${Math.max(30, Math.round(targetSec * 0.6))}_${targetSec * 4 + 60}`);

  console.log(`[music] Jamendo: searching "${style.jamendoTags}" (${targetSec}s target)...`);

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) {
    console.warn(`[music] Jamendo API ${resp.status}`);
    return null;
  }
  const data = await resp.json() as any;
  const tracks: any[] = data.results ?? [];
  if (!tracks.length) {
    console.warn(`[music] Jamendo: no tracks for "${style.jamendoTags}"`);
    return null;
  }

  const track = tracks[0];
  const audioUrl: string = track.audiodownload || track.audio;
  if (!audioUrl) {
    console.warn('[music] Jamendo: track has no audio URL');
    return null;
  }

  console.log(`[music] Jamendo: "${track.name}" by ${track.artist_name}`);

  const tempMp3 = outputPath.replace(/\.mp3$/, '_jam_raw.mp3');
  await downloadToFile(audioUrl, tempMp3);

  if (targetSec > 10) {
    await loopToFit(tempMp3, outputPath, targetSec);
    await fs.unlink(tempMp3).catch(() => {});
  } else {
    await fs.rename(tempMp3, outputPath);
  }

  console.log(`[music] Jamendo ready: ${path.basename(outputPath)}`);
  return outputPath;
}

// ── Source 2: FAL.AI Stable Audio ────────────────────────────────────────────

const FAL_QUEUE = 'https://queue.fal.run';

async function fetchFalAudio(style: MusicStyleDef, targetSec: number, outputPath: string): Promise<string | null> {
  const falKey = process.env.FAL_AI_API_KEY;
  if (!falKey || !style.falPrompt) return null;

  const clampedSec = Math.min(targetSec, 47); // stable-audio max ~47s; we'll loop
  console.log(`[music] FAL Stable Audio: "${style.label}" (${clampedSec}s)...`);

  // Submit
  const submitRes = await fetch(`${FAL_QUEUE}/fal-ai/stable-audio`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: style.falPrompt, seconds_total: clampedSec, steps: 100 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submitRes.ok) {
    const txt = await submitRes.text();
    console.warn(`[music] FAL submit ${submitRes.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const queued = await submitRes.json() as any;
  if (!queued.status_url || !queued.response_url) {
    console.warn('[music] FAL: no status/response URL');
    return null;
  }

  // Poll
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    await new Promise((r) => setTimeout(r, 5_000));
    const statusRes = await fetch(queued.status_url, {
      headers: { Authorization: `Key ${falKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusRes.ok) continue;
    const status = await statusRes.json() as any;
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED') {
      console.warn('[music] FAL Stable Audio job failed');
      return null;
    }
  }

  // Fetch result
  const resultRes = await fetch(queued.response_url, {
    headers: { Authorization: `Key ${falKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resultRes.ok) return null;
  const result = await resultRes.json() as any;
  const audioUrl: string = result.audio_file?.url ?? result.audio?.url ?? result.url;
  if (!audioUrl) {
    console.warn('[music] FAL: no audio URL in result');
    return null;
  }

  const tempFile = outputPath.replace(/\.mp3$/, '_fal_raw');
  await downloadToFile(audioUrl, tempFile);

  // Convert to mp3
  const tempMp3 = outputPath.replace(/\.mp3$/, '_fal.mp3');
  await execFileAsync(FFMPEG, ['-y', '-i', tempFile, '-codec:a', 'libmp3lame', '-q:a', '4', tempMp3]);
  await fs.unlink(tempFile).catch(() => {});

  if (targetSec > clampedSec + 1) {
    await loopToFit(tempMp3, outputPath, targetSec);
    await fs.unlink(tempMp3).catch(() => {});
  } else {
    await fs.rename(tempMp3, outputPath);
  }

  console.log(`[music] FAL ready: ${path.basename(outputPath)}`);
  return outputPath;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateBackgroundMusic(params: {
  style?: string;
  outputPath: string;
  targetDurationSec: number;
}): Promise<string | null> {
  const { style: styleValue, outputPath, targetDurationSec } = params;

  const styleDef = getMusicStyle(styleValue);
  if (styleDef.value === 'none') {
    console.log('[music] Style=none — skipping background music');
    return null;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Source 1: Jamendo stock
  try {
    const result = await fetchJamendoTrack(styleDef, targetDurationSec, outputPath);
    if (result) return result;
  } catch (err: any) {
    console.warn(`[music] Jamendo error: ${err.message}`);
  }

  // Source 2: FAL Stable Audio
  try {
    const result = await fetchFalAudio(styleDef, targetDurationSec, outputPath);
    if (result) return result;
  } catch (err: any) {
    console.warn(`[music] FAL error: ${err.message}`);
  }

  console.warn('[music] All music sources failed — video will have no background music');
  return null;
}

/** @deprecated use generateBackgroundMusic({ style }) */
export function buildMusicPrompt(topic: string): string {
  return `background music for a video about "${topic.slice(0, 80)}", ambient cinematic, no vocals`;
}

/**
 * Automatically selects a music style based on topic keywords.
 * Used as fallback when user has not explicitly chosen a music style.
 */
export function autoMusicStyle(topic: string): string {
  const t = topic.toLowerCase();
  if (/путешест|природ|горы|море|лес|арктик|норвег|остров|закат|рассвет|travel|nature|mountain|ocean|forest|arctic|sunset|landscape/i.test(t)) return 'cinematic';
  if (/технолог|искусствен|робот|программ|digital|tech|\bai\b|startup|innovation|будущ|нейро/i.test(t)) return 'electronic';
  if (/бизнес|продаж|маркетинг|успех|карьер|бренд|business|sales|marketing|success|brand|entrepreneur/i.test(t)) return 'corporate';
  if (/фитнес|спорт|здоров|трениров|workout|fitness|sport|gym|motivation|мотивац/i.test(t)) return 'electronic';
  if (/кулинар|еда|рецепт|food|cooking|recipe|restaurant|вкусн/i.test(t)) return 'acoustic';
  if (/мод|красот|лайфстайл|уход|fashion|beauty|lifestyle|skincare/i.test(t)) return 'acoustic';
  if (/история|документ|наука|history|documentary|science|space|космос/i.test(t)) return 'cinematic';
  return 'cinematic';
}
