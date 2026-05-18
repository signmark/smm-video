/**
 * Background music generation via HuggingFace MusicGen.
 * Generates ambient/cinematic music from a text prompt, loops it to fit the video duration.
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

const MUSICGEN_MODEL = 'facebook/musicgen-small';

/**
 * Build a music style prompt from the video topic.
 * No extra AI call needed — constructs a good prompt directly.
 */
export function buildMusicPrompt(topic: string): string {
  const clean = topic.slice(0, 80).replace(/[^\wа-яёА-ЯЁ\s,.!?-]/gi, '').trim();
  return `background music for a video about "${clean}", ambient cinematic, no vocals, soft instrumental, calm, suitable for voice-over narration`;
}

/**
 * Generate background music via HuggingFace MusicGen.
 * Returns the output mp3 path, or null if generation failed.
 */
export async function generateBackgroundMusic(params: {
  prompt: string;
  outputPath: string;
  targetDurationSec: number;
}): Promise<string | null> {
  const { prompt, outputPath, targetDurationSec } = params;
  const hfKey = process.env.HUGGINGFACE_API_KEY;

  if (!hfKey) {
    console.warn('[music] No HUGGINGFACE_API_KEY — skipping background music');
    return null;
  }

  console.log(`[music] Generating via MusicGen: "${prompt.slice(0, 80)}..."`);

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${MUSICGEN_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 512 },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const msg = await res.text();
      console.warn(`[music] MusicGen failed: ${res.status} — ${msg.slice(0, 200)}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) {
      console.warn('[music] MusicGen returned empty audio');
      return null;
    }

    const rawPath = outputPath.replace(/\.mp3$/, '_raw');
    await fs.writeFile(rawPath, buf);

    const tempMp3 = outputPath.replace(/\.mp3$/, '_raw.mp3');
    await execFileAsync(FFMPEG, ['-y', '-i', rawPath, '-codec:a', 'libmp3lame', '-q:a', '4', tempMp3]);
    await fs.unlink(rawPath).catch(() => {});

    if (targetDurationSec > 5) {
      await loopToFit(tempMp3, outputPath, targetDurationSec);
      await fs.unlink(tempMp3).catch(() => {});
    } else {
      await fs.rename(tempMp3, outputPath);
    }

    console.log(`[music] Ready: ${path.basename(outputPath)} (looped to ${targetDurationSec}s)`);
    return outputPath;
  } catch (err: any) {
    console.warn(`[music] Error: ${err.message}`);
    return null;
  }
}

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
