/**
 * Text-to-speech via OpenAI TTS API.
 * Audio is returned at its natural pace — the video assembler sets each clip's length
 * to the audio duration, so no speed adjustment is needed (and speeding up only some
 * scenes made voice pacing inconsistent between scenes).
 * Falls back to Microsoft Edge TTS (free, no key) then HuggingFace.
 */
import fs from 'fs/promises';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const execFileAsync = promisify(execFile);

// Prefer system ffmpeg (Alpine Docker); fall back to installer binary (Replit/glibc)
function resolveFfmpegPath(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return ffmpegInstaller.path;
}
const FFMPEG = resolveFfmpegPath();

const DEFAULT_VOICE_BY_LANG: Record<string, string> = {
  ru: 'alloy',
  en: 'alloy',
};

const VALID_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);

// Instructions in English — models parse English meta-instructions more reliably
const INSTRUCTIONS_BY_LANG: Record<string, string> = {
  ru: 'Speak Russian only. You are an energetic viral content creator and podcast host. Delivery: fast, punchy, confident. Emphasize key words with rising pitch. Use very brief dramatic pauses (80–120 ms) before surprising facts or numbers. Never monotone — vary speed and energy across sentences. Sound passionate, urgent, and authoritative. No filler, no hesitation. The text may contain stress marks (a combining acute accent placed right after a vowel) — always pronounce that exact syllable as the stressed one.',
  en: 'You are an energetic viral content creator and podcast host. Delivery: fast, punchy, confident. Emphasize key words with rising pitch. Use very brief dramatic pauses before surprising facts. Never monotone — vary speed and energy. Sound passionate, urgent, and authoritative. No filler.',
};

// ─── Russian stress accentuation (context-aware homograph fix) ────────────────
// Russian TTS (OpenAI gpt-4o-mini-tts + Edge neural voices) honor the Unicode
// combining acute accent (U+0301) placed right after a stressed vowel. We ask
// Gemini to insert those marks with full sentence context so homographs like
// "духи́" (perfume) vs "ду́хи" (spirits) are pronounced correctly.
// Best-effort: any failure, missing key, or non-Cyrillic text → original text.
const accentCache = new Map<string, string>();
const CYRILLIC_RE = /[а-яё]/i;

function stripStressMarks(s: string): string {
  return s.replace(/\u0301/g, '');
}

function geminiBaseForTts(): string {
  const proxyUrl = process.env.GEMINI_PROXY_URL;
  if (proxyUrl) {
    try { const u = new URL(proxyUrl); return `${u.protocol}//${u.host}`; } catch {}
  }
  return 'https://generativelanguage.googleapis.com';
}

async function accentuateRussian(text: string): Promise<string> {
  if (!CYRILLIC_RE.test(text)) return text;
  const cached = accentCache.get(text);
  if (cached !== undefined) return cached;

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return text;

  const systemInstruction =
    'Ты — система простановки ударений в русском тексте для синтеза речи. ' +
    'Верни ТОТ ЖЕ текст без единого изменения слов, их порядка, пунктуации, регистра, переносов и пробелов, ' +
    'добавив ТОЛЬКО знак ударения — комбинирующий акут U+0301 — сразу ПОСЛЕ ударной гласной в каждом многосложном слове. ' +
    'Букву «ё» не заменяй и не добавляй. Особое внимание омографам: ставь ударение строго по СМЫСЛУ предложения ' +
    '(духи́ — парфюм; ду́хи — призраки; за́мок — здание; замо́к — на двери; бо́льшая/больша́я; и т.п.). ' +
    'Не добавляй пояснений, кавычек, markdown — выведи только сам текст с ударениями.';

  try {
    const url = `${geminiBaseForTts()}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[tts:accent] Gemini ${res.status} — using plain text`);
      accentCache.set(text, text); // cache fallback to avoid re-hitting a failing key per scene
      return text;
    }
    const data = await res.json() as any;
    const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
    const out = parts.map((p: any) => p.text || '').join('').trim();
    // Safety net: accept ONLY if the model changed nothing but stress marks.
    // Guards against the model rewriting words, adding quotes/markdown, swapping е↔ё, etc.
    if (!out || stripStressMarks(out) !== text.trim()) {
      console.warn('[tts:accent] result altered text beyond stress marks — using plain text');
      accentCache.set(text, text);
      return text;
    }
    const marks = (out.match(/\u0301/g) || []).length;
    console.log(`[tts:accent] added ${marks} stress mark(s)`);
    accentCache.set(text, out);
    return out;
  } catch (err: any) {
    console.warn(`[tts:accent] error: ${err.message} — using plain text`);
    return text;
  }
}

export async function generateAudio(params: {
  text: string;
  language: 'ru' | 'en';
  outputPath: string; // should be .mp3
  targetDuration?: number; // target clip length in seconds
  voice?: string; // override default voice
}): Promise<{ path: string; duration: number } | null> {
  // Guard: null/undefined language defaults to Russian
  const lang = (params.language ?? 'ru') as 'ru' | 'en';
  const { text, outputPath } = params;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[tts] No OPENAI_API_KEY — skipping audio');
    return null;
  }

  if (!text.trim()) return null;

  // Context-aware Russian stress so homographs (духи́/ду́хи) are read correctly.
  // synthText feeds OpenAI + Edge (both honor U+0301); HuggingFace mms gets raw text.
  const synthText = lang === 'ru' ? await accentuateRussian(text) : text;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const voice = (params.voice && VALID_VOICES.has(params.voice)) ? params.voice : (DEFAULT_VOICE_BY_LANG[lang] ?? 'alloy');
  const instructions = INSTRUCTIONS_BY_LANG[lang];

  console.log(`[tts] lang=${lang}, voice=${voice}, text_len=${text.length}`);

  // Helper: single TTS attempt with given model and timeout
  async function attemptTTS(model: string, timeoutMs: number): Promise<Response> {
    const body: Record<string, any> = { model, voice, input: synthText, response_format: 'mp3' };
    if (model === 'gpt-4o-mini-tts') body.instructions = instructions;
    return fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  // Try gpt-4o-mini-tts, then tts-1, then HuggingFace on 429
  let res: Response | null = null;
  let openAiQuotaExceeded = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await attemptTTS('gpt-4o-mini-tts', 50000);
      if (res.ok) break;
      if (res.status === 429) {
        console.warn(`[tts] OpenAI TTS quota exceeded (429) — switching to HuggingFace`);
        openAiQuotaExceeded = true;
        res = null;
        break;
      }
      if (res.status === 404 || res.status === 400) {
        console.warn(`[tts] gpt-4o-mini-tts unavailable (${res.status}), switching to tts-1`);
        res = null;
        break;
      }
      throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (err: any) {
      if (attempt === 2) throw err;
      console.warn(`[tts] attempt ${attempt} failed: ${err.message} — retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Fall back to tts-1 if gpt-4o-mini-tts unavailable (but not on quota error)
  if (!res && !openAiQuotaExceeded) {
    console.warn(`[tts] falling back to tts-1`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await attemptTTS('tts-1', 45000);
        if (res.ok) break;
        if (res.status === 429) {
          console.warn(`[tts] tts-1 quota exceeded (429) — switching to HuggingFace`);
          openAiQuotaExceeded = true;
          res = null;
          break;
        }
        throw new Error(`OpenAI TTS tts-1 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (err: any) {
        if (attempt === 2) throw err;
        console.warn(`[tts] tts-1 attempt ${attempt} failed: ${err.message} — retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // Fallback chain: Edge TTS (free, no key) → HuggingFace
  if (!res || openAiQuotaExceeded) {
    console.warn(`[tts] OpenAI unavailable — trying Edge TTS fallback`);

    let fallbackOk = await generateWithEdgeTTS(synthText, lang, outputPath, params.voice);

    if (!fallbackOk) {
      console.warn(`[tts] Edge TTS failed — trying HuggingFace`);
      // HuggingFace mms-tts g2p can't use stress marks — feed raw text.
      fallbackOk = await generateWithHuggingFace(text, lang, outputPath);
    }

    if (fallbackOk) {
      const rawDuration = await getAudioDuration(outputPath);
      console.log(`[tts] Fallback generated ${path.basename(outputPath)} (${rawDuration.toFixed(2)}s)`);
      // Natural pacing: no atempo speed-up. The assembler sets each clip's length to the
      // audio's natural duration, so voice fills every scene without being rushed.
      return { path: outputPath, duration: rawDuration };
    }
    throw new Error('[tts] All TTS providers failed (OpenAI quota + Edge TTS failed + HuggingFace failed)');
  }

  if (!res || !res.ok) throw new Error(`[tts] All attempts failed`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outputPath, buf);

  const rawDuration = await getAudioDuration(outputPath);
  console.log(`[tts] Generated ${path.basename(outputPath)} (${rawDuration.toFixed(2)}s)`);

  // Natural pacing: no atempo speed-up. The assembler sets each clip's length to the
  // audio's natural duration, so voice fills every scene without being rushed. Speeding
  // up only long-narration scenes made voice speed inconsistent between scenes.
  return { path: outputPath, duration: rawDuration };
}

// ─── Microsoft Edge TTS (free, no API key required) ───────────────────────────
// Edge TTS: только подтверждённые голоса (Dmitry=мужской, Svetlana=женский)
// Питч-сдвиг через ffmpeg делает каждый голос звучащим по-разному
const EDGE_TTS_VOICE_MAP: Record<string, Record<string, { voice: string; semitones: number }>> = {
  ru: {
    alloy:   { voice: 'ru-RU-DmitryNeural',   semitones:  0  }, // мужской нейтральный
    ash:     { voice: 'ru-RU-DmitryNeural',   semitones: -1  }, // мужской чуть ниже
    ballad:  { voice: 'ru-RU-SvetlanaNeural', semitones: +1  }, // женский чуть выше
    coral:   { voice: 'ru-RU-SvetlanaNeural', semitones: +2  }, // женский выше
    echo:    { voice: 'ru-RU-DmitryNeural',   semitones: -1  }, // мужской мягкий
    fable:   { voice: 'ru-RU-SvetlanaNeural', semitones:  0  }, // женский нейтральный
    nova:    { voice: 'ru-RU-SvetlanaNeural', semitones: +1  }, // женский тёплый
    onyx:    { voice: 'ru-RU-DmitryNeural',   semitones: -3  }, // мужской глубокий
    sage:    { voice: 'ru-RU-SvetlanaNeural', semitones: +2  }, // женский мягкий
    shimmer: { voice: 'ru-RU-SvetlanaNeural', semitones: +3  }, // женский высокий
  },
  en: {
    alloy:   { voice: 'en-US-GuyNeural',   semitones:  0  },
    ash:     { voice: 'en-US-GuyNeural',   semitones: -1  },
    ballad:  { voice: 'en-US-JennyNeural', semitones:  0  },
    coral:   { voice: 'en-US-AriaNeural',  semitones: +2  },
    echo:    { voice: 'en-US-GuyNeural',   semitones: -1  },
    fable:   { voice: 'en-US-AriaNeural',  semitones:  0  },
    nova:    { voice: 'en-US-JennyNeural', semitones: +1  },
    onyx:    { voice: 'en-US-GuyNeural',   semitones: -3  },
    sage:    { voice: 'en-US-AriaNeural',  semitones: +1  },
    shimmer: { voice: 'en-US-JennyNeural', semitones: +2  },
  },
};

async function applyPitchShift(filePath: string, semitones: number): Promise<void> {
  if (semitones === 0) return;
  const factor = Math.pow(2, semitones / 12);
  const baseRate = 24000;
  const newRate = Math.round(baseRate * factor);
  const tempo = 1 / factor; // корректируем темп чтобы длительность не изменилась
  const tmpPath = filePath + '_pitch.mp3';
  try {
    await execFileAsync(FFMPEG, [
      '-y', '-i', filePath,
      '-af', `asetrate=${newRate},atempo=${tempo.toFixed(6)},aresample=${baseRate}`,
      '-codec:a', 'libmp3lame', '-q:a', '4',
      tmpPath
    ]);
    await fs.rename(tmpPath, filePath);
  } catch (err: any) {
    console.warn(`[tts] pitch shift failed (${semitones} st): ${err.message}`);
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

async function generateWithEdgeTTS(text: string, lang: string, outputPath: string, openaiVoice?: string): Promise<boolean> {
  const mapping = openaiVoice ? EDGE_TTS_VOICE_MAP[lang]?.[openaiVoice] : null;
  const edgeVoice = mapping?.voice ?? (lang === 'ru' ? 'ru-RU-SvetlanaNeural' : 'en-US-JennyNeural');
  const semitones = mapping?.semitones ?? 0;

  try {
    console.log(`[tts] Edge TTS voice=${edgeVoice} semitones=${semitones} lang=${lang}`);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const tmpDir = outputPath + '_edgetmp';
    await fs.mkdir(tmpDir, { recursive: true });
    await tts.toFile(tmpDir, text);

    const tmpFile = path.join(tmpDir, 'audio.mp3');
    const stat = await fs.stat(tmpFile).catch(() => null);
    if (!stat || stat.size < 100) {
      console.warn('[tts] Edge TTS returned empty audio');
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return false;
    }

    await fs.rename(tmpFile, outputPath);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    // Применяем питч-сдвиг для отличия голосов
    await applyPitchShift(outputPath, semitones);

    return true;
  } catch (err: any) {
    console.warn(`[tts] Edge TTS error: ${err.message}`);
    return false;
  }
}

// ─── HuggingFace TTS models (fallback) ────────────────────────────────────────
const HF_TTS_MODELS: Record<string, string> = {
  ru: 'facebook/mms-tts-rus',
  en: 'facebook/mms-tts-eng',
};

async function generateWithHuggingFace(text: string, lang: string, outputPath: string): Promise<boolean> {
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) {
    console.warn('[tts] No HUGGINGFACE_API_KEY — skipping HF fallback');
    return false;
  }

  const model = HF_TTS_MODELS[lang] ?? HF_TTS_MODELS.en;
  console.log(`[tts] HuggingFace TTS model=${model} lang=${lang} text_len=${text.length}`);

  try {
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      console.warn(`[tts] HuggingFace TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) {
      console.warn('[tts] HuggingFace returned empty audio');
      return false;
    }

    // HF returns wav — convert to mp3 via ffmpeg
    const wavPath = outputPath.replace(/\.mp3$/, '_hf.wav');
    await fs.writeFile(wavPath, buf);
    await execFileAsync(FFMPEG, ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '4', outputPath]);
    await fs.unlink(wavPath).catch(() => {});
    return true;
  } catch (err: any) {
    console.warn(`[tts] HuggingFace TTS error: ${err.message}`);
    return false;
  }
}

/**
 * Transcribes an audio file with OpenAI Whisper and returns word-level timestamps.
 * Uses verbose_json + timestamp_granularities=['word'] to get per-word start/end times.
 * Returns null when OpenAI is unavailable or transcription fails (caller should handle gracefully).
 */
export async function getWordTimestamps(
  audioPath: string,
): Promise<{ word: string; start: number; end: number }[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[tts:whisper] No OPENAI_API_KEY — skipping word timestamps');
    return null;
  }

  try {
    const audioBuf = await fs.readFile(audioPath);
    const blob = new Blob([audioBuf], { type: 'audio/mpeg' });

    const form = new FormData();
    form.append('file', blob, path.basename(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      console.warn(`[tts:whisper] Transcription failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { words?: { word: string; start: number; end: number }[] };
    if (!Array.isArray(data.words) || data.words.length === 0) {
      console.warn('[tts:whisper] Transcription returned no word timestamps');
      return null;
    }

    console.log(`[tts:whisper] Got ${data.words.length} word timestamps from ${path.basename(audioPath)}`);
    return data.words;
  } catch (err: any) {
    console.warn(`[tts:whisper] getWordTimestamps error: ${err.message}`);
    return null;
  }
}

async function getAudioDuration(filePath: string): Promise<number> {
  // Try system ffprobe first (available in Nix/PATH), fallback to ffmpeg-installer sibling
  const candidates = ['ffprobe', FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe')];
  for (const bin of candidates) {
    try {
      const { stdout } = await execFileAsync(bin, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const dur = parseFloat(stdout.trim());
      if (dur > 0) return dur;
    } catch {
      // try next candidate
    }
  }
  return 3;
}
