/**
 * Generates TTS voice preview files using Microsoft Edge TTS + ffmpeg pitch shifting.
 * Output: video-app/server/assets/previews/{voice}_{lang}_v3.mp3
 * Run from repo root: node video-app/scripts/gen-previews.mjs
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../server/assets/previews');

const SAMPLE = {
  ru: 'Привет! Это пример голоса для вашего видео. Выберите тот, который вам нравится больше всего.',
  en: 'Hello! This is a voice sample for your video. Choose the one you like the most.',
};

const VOICE_MAP = {
  ru: {
    alloy:   { voice: 'ru-RU-DmitryNeural',   semitones:  0 },
    ash:     { voice: 'ru-RU-DmitryNeural',   semitones: -1 },
    ballad:  { voice: 'ru-RU-SvetlanaNeural', semitones: +1 },
    coral:   { voice: 'ru-RU-SvetlanaNeural', semitones: +2 },
    echo:    { voice: 'ru-RU-DmitryNeural',   semitones: -1 },
    fable:   { voice: 'ru-RU-SvetlanaNeural', semitones:  0 },
    nova:    { voice: 'ru-RU-SvetlanaNeural', semitones: +1 },
    onyx:    { voice: 'ru-RU-DmitryNeural',   semitones: -3 },
    sage:    { voice: 'ru-RU-SvetlanaNeural', semitones: +2 },
    shimmer: { voice: 'ru-RU-SvetlanaNeural', semitones: +3 },
  },
  en: {
    alloy:   { voice: 'en-US-GuyNeural',   semitones:  0 },
    ash:     { voice: 'en-US-GuyNeural',   semitones: -1 },
    ballad:  { voice: 'en-US-JaneNeural',  semitones: +1 },
    coral:   { voice: 'en-US-AriaNeural',  semitones: +2 },
    echo:    { voice: 'en-US-GuyNeural',   semitones: -1 },
    fable:   { voice: 'en-US-JaneNeural',  semitones:  0 },
    nova:    { voice: 'en-US-JennyNeural', semitones: +1 },
    onyx:    { voice: 'en-US-GuyNeural',   semitones: -3 },
    sage:    { voice: 'en-US-AriaNeural',  semitones: +1 },
    shimmer: { voice: 'en-US-JennyNeural', semitones: +2 },
  },
};

async function applyPitchShift(filePath, semitones) {
  if (semitones === 0) return;
  const factor = Math.pow(2, semitones / 12);
  const newRate = Math.round(24000 * factor);
  const tempo = (1 / factor).toFixed(6);
  const tmp = filePath + '_pitch.mp3';
  await execFileAsync('ffmpeg', [
    '-y', '-i', filePath,
    '-af', `asetrate=${newRate},atempo=${tempo},aresample=24000`,
    '-codec:a', 'libmp3lame', '-q:a', '4',
    tmp,
  ]);
  await fs.rename(tmp, filePath);
}

async function generateOne(voice, lang) {
  const outFile = path.join(OUT_DIR, `${voice}_${lang}_v3.mp3`);
  const { voice: edgeVoice, semitones } = VOICE_MAP[lang][voice];
  const text = SAMPLE[lang];
  const tmpDir = outFile + '_tmp';

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    await tts.toFile(tmpDir, text);

    const tmpFile = path.join(tmpDir, 'audio.mp3');
    const stat = await fs.stat(tmpFile).catch(() => null);
    if (!stat || stat.size < 100) throw new Error('Empty audio');

    await fs.rename(tmpFile, outFile);
    await fs.rm(tmpDir, { recursive: true, force: true });

    await applyPitchShift(outFile, semitones);
    console.log(`  OK  ${voice}_${lang}_v3.mp3  (${edgeVoice}, ${semitones > 0 ? '+' : ''}${semitones} st)`);
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.error(`  ERR ${voice}_${lang}_v3.mp3: ${err.message}`);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const lang of ['ru', 'en']) {
    console.log(`\n── ${lang.toUpperCase()} ──`);
    for (const voice of Object.keys(VOICE_MAP[lang])) {
      await generateOne(voice, lang);
    }
  }
  console.log('\nDone.');
}

main();
