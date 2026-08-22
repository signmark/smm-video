import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  DATA_PATHS,
  hasVideoFile,
  RETENTION_DAYS,
  type Scene,
  type VideoFormat,
  type AnimationModel,
  type SubtitleStyle,
  type Script,
} from './db.js';

// Ждёт пока файл появится на диске с ненулевым размером (до 10с, опрос каждые 300мс)
async function waitForFile(filePath: string, maxMs = 10000): Promise<void> {
  const step = 300;
  for (let elapsed = 0; elapsed < maxMs; elapsed += step) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 0) return;
    } catch { /* ещё нет */ }
    await new Promise(r => setTimeout(r, step));
  }
}

import { generateScript } from './services/script-generator.js';
import { generateImage, generateLayeredImage } from './services/image-generator.js';
import { generateAudio, getWordTimestamps } from './services/tts-generator.js';
import { assembleVideo, assembleFromClips, extractLastFrame, burnSubtitles, subtitleSizeMultiplier, mixBackgroundMusic, makeStaticClipFromImage, makeTitleCardClip, probeActualDuration, type WordTimestamp } from './services/video-assembler.js';
import { generateBackgroundMusic, getMusicStyle, autoMusicStyle } from './services/music-generator.js';

import { animateFrame, animateText, isT2VModel, generateAvatarClip, generateAgentVideo, DEFAULT_HEYGEN_AVATAR, transcribeAudioFal } from './services/fal-animator.js';
import { searchAndDownloadStockClip, searchAndDownloadStockPhoto } from './services/stock-video.js';
import { ensureKeysLoaded } from './load-keys.js';
import { planVideo } from './services/director.js';
import { decideResumeStage } from './resume-policy.js';

const VALID_SUBTITLE_STYLES: SubtitleStyle[] = ['none', 'plain', 'fade', 'fade-zoom', 'karaoke', 'tiktok', 'word-by-word', 'cinematic', 'cinematic-full', 'bar', 'word-timed'];

/**
 * Transcribes one scene's TTS audio to word-level timestamps, preferring FAL's
 * hosted Whisper (fal-ai/whisper) over OpenAI's. FAL_AI_API_KEY is a required key
 * elsewhere in this app (animation cannot run without it) and is therefore reliably
 * present, whereas OPENAI_API_KEY is frequently unset — so FAL is tried first and
 * OpenAI Whisper is only a fallback for when FAL itself fails or is unreachable.
 * Returns [] (not null) so callers can safely concatenate/count across scenes.
 */
async function getSceneWordTimestamps(audioPath: string): Promise<WordTimestamp[]> {
  try {
    const fal = await transcribeAudioFal(audioPath);
    if (fal && fal.length > 0) return fal;
  } catch {}
  try {
    const openai = await getWordTimestamps(audioPath);
    if (openai && openai.length > 0) return openai;
  } catch {}
  return [];
}

/**
 * Wrapper around burnSubtitles that powers the 'word-timed' style: transcribes
 * each scene's TTS audio (FAL Whisper primary, OpenAI Whisper fallback) to obtain
 * real per-word start/end times, so every word appears exactly when it is spoken
 * instead of being spread evenly across the scene. All other styles pass straight
 * through unchanged.
 *
 * Degradation is graceful: a scene whose audio is missing or whose transcription
 * fails on both providers contributes an empty timestamp list; if no scene yields
 * any timestamps at all (e.g. both FAL_AI_API_KEY and OPENAI_API_KEY are unset),
 * wordTimestamps is dropped and burnSubtitles falls back to its estimated-timing
 * tiktok renderer.
 */
async function burnSubtitlesSynced(params: Parameters<typeof burnSubtitles>[0]): Promise<void> {
  let wordTimestamps = params.wordTimestamps;
  if (params.style === 'word-timed' && !wordTimestamps) {
    wordTimestamps = await Promise.all(
      params.scenes.map(async (s) => {
        const audioPath = (s as { audioPath?: string }).audioPath;
        if (!audioPath) return [];
        return getSceneWordTimestamps(audioPath);
      }),
    );
    const total = wordTimestamps.reduce((n, w) => n + w.length, 0);
    if (total === 0) {
      console.warn('[subtitles] word-timed: no Whisper timestamps (FAL + OpenAI both unavailable) — falling back to estimated timing');
      wordTimestamps = undefined;
    } else {
      console.log(`[subtitles] word-timed: aligned ${total} words across ${params.scenes.length} scenes via Whisper`);
    }
  }
  await burnSubtitles({ ...params, wordTimestamps });
}

/**
 * If the scene list contains a hook-role scene with text, prepend a 0.7 s
 * title card as scene[0]. The card has no narration, so burnSubtitles skips
 * generating a subtitle for it but correctly offsets all subsequent scenes.
 * Returns the original array unchanged when no hook scene is found.
 */
type AssembledScene = { clipPath: string; duration: number; narration?: string; text?: string; role?: 'hook' | 'body' | 'cta'; audioPath?: string; audioDuration?: number };
async function maybeWithTitleCard(scenes: AssembledScene[], format: VideoFormat, tempDir: string): Promise<AssembledScene[]> {
  const hookScene = scenes.find(s => s.role === 'hook' && s.text?.trim());
  if (!hookScene) return scenes;
  try {
    const cardPath = path.join(tempDir, `title_card_${Date.now()}.mp4`);
    await fs.mkdir(tempDir, { recursive: true });
    await makeTitleCardClip({
      text: hookScene.text!.trim().slice(0, 80),
      durationSeconds: 0.7,
      outputPath: cardPath,
      format,
      style: 'accent',
    });
    console.log(`[title-card] Prepended 0.7s title card: "${hookScene.text!.trim().slice(0, 40)}"`);
    return [{ clipPath: cardPath, duration: 0.7 }, ...scenes];
  } catch (e: any) {
    console.warn('[title-card] Could not prepend title card:', e.message);
    return scenes;
  }
}

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'video-gen', version: '2.0.0' });
});

router.get('/videos', async (_req, res) => {
  try {
    const projects = await listProjects();
    const enriched = projects.map((p) => ({ ...p, hasFile: hasVideoFile(p), retentionDays: RETENTION_DAYS }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/videos/:id', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json({ ...project, hasFile: hasVideoFile(project), retentionDays: RETENTION_DAYS });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const ALL_MODELS: AnimationModel[] = ['wan', 'kling', 'kling-pro', 'minimax', 'seedance', 'seedance2', 'wan-t2v', 'kling-t2v', 'kling-pro-t2v', 'luma', 'veo3', 'heygen-avatar', 'heygen-agent', 'chain'];

// Models whose clip length is fixed by the provider (not user-selectable). For
// these, clipDuration must be ignored so scene layout/assembly use the real length.
const FIXED_DURATION_MODELS = new Set<string>(['veo3']);

const VALID_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);

// TTS preview: serve pre-generated static file (baked into Docker image), fallback to dynamic generation
router.get('/tts-preview/:voice', async (req, res) => {
  await ensureKeysLoaded();
  const voice = req.params.voice;
  if (!VALID_VOICES.has(voice)) {
    return res.status(400).json({ error: 'Invalid voice' });
  }
  const lang = (req.query.lang === 'en') ? 'en' : 'ru';
  const fileName = `${voice}_${lang}_v3.mp3`;

  // 1. Serve pre-generated static file baked into Docker image (always available, no API needed)
  const staticFile = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets/previews', fileName);
  try {
    await fs.access(staticFile);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(staticFile);
  } catch {}

  // 2. Fallback: dynamic generation + cache in data/previews/
  const cacheDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/previews');
  const cacheFile = path.join(cacheDir, fileName);
  try {
    await fs.access(cacheFile);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    const buf = await fs.readFile(cacheFile);
    return res.send(buf);
  } catch {}

  const sampleText: Record<string, string> = {
    ru: 'Привет! Это пример голоса для вашего видео. Выберите тот, который вам нравится больше всего.',
    en: 'Hello! This is a voice sample for your video. Choose the one you like the most.',
  };

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const result = await generateAudio({
      text: sampleText[lang],
      language: lang as 'ru' | 'en',
      outputPath: cacheFile,
      voice,
    });
    if (!result) return res.status(502).json({ error: 'TTS unavailable' });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    const buf = await fs.readFile(cacheFile);
    return res.send(buf);
  } catch (err: any) {
    console.error(`[tts-preview] ${voice}/${lang} failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Music preview: proxies Jamendo audio stream to avoid CORS + stale token issues
router.get('/music/preview', async (req, res) => {
  await ensureKeysLoaded();
  const styleValue = String(req.query.style || 'ambient');
  const styleDef = getMusicStyle(styleValue);

  if (styleDef.value === 'none' || !styleDef.jamendoTags) {
    return res.status(400).json({ error: 'No preview available for this style' });
  }

  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'JAMENDO_CLIENT_ID not configured' });
  }

  try {
    const url = new URL('https://api.jamendo.com/v3.0/tracks/');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '10');
    url.searchParams.set('fuzzytags', styleDef.jamendoTags);
    url.searchParams.set('boost', 'popularity_total');
    url.searchParams.set('order', 'popularity_total_desc');

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return res.status(502).json({ error: `Jamendo API error: ${resp.status}` });

    const data = await resp.json() as any;
    const tracks: any[] = data.results ?? [];
    if (!tracks.length) return res.status(404).json({ error: 'No tracks found for this style' });

    // idx param allows cycling through tracks (0-9)
    const idxParam = Math.min(Math.max(parseInt(String(req.query.idx || '0'), 10) || 0, 0), tracks.length - 1);

    // For meta request: pick first track with an audio URL starting at idxParam
    if (req.query.meta === '1') {
      const metaTrack = tracks.slice(idxParam).find((t: any) => t.audio?.startsWith('http')) ?? tracks[idxParam];
      return res.json({ trackName: metaTrack?.name ?? '', artistName: metaTrack?.artist_name ?? '' });
    }

    // For audio proxy: stream the first working track starting at idxParam
    // Try both mp31 and mp32 formats for each track
    const candidates = [...tracks.slice(idxParam), ...tracks.slice(0, idxParam)];
    for (const t of candidates) {
      if (!t.audio?.startsWith('http')) continue;

      // Build candidate URLs: try mp32 first (more available), fallback to mp31
      const baseAudio: string = t.audio;
      const audioUrls = [
        baseAudio.replace('format=mp31', 'format=mp32'),
        baseAudio,
      ].filter((u, i, a) => a.indexOf(u) === i); // deduplicate

      let audioFetch: globalThis.Response | null = null;
      let usedUrl = '';
      for (const audioUrl of audioUrls) {
        try {
          const r = await fetch(audioUrl, {
            signal: AbortSignal.timeout(20_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VideoBot/1.0)' },
          });
          const ct = r.headers.get('content-type') || '';
          if (r.ok && ct.startsWith('audio')) {
            audioFetch = r; usedUrl = audioUrl; break;
          }
          console.log(`[music-preview] Track ${t.id} url ${audioUrl.slice(-20)} — HTTP ${r.status} ${ct}`);
          await r.body?.cancel();
        } catch (e: any) {
          console.log(`[music-preview] Track ${t.id} — ${e.message}`);
        }
      }

      if (!audioFetch) continue;

      // Found a working track — stream it back
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Track-Name', encodeURIComponent(t.name));
      res.setHeader('X-Artist-Name', encodeURIComponent(t.artist_name));
      res.setHeader('Cache-Control', 'public, max-age=300');

      const reader = audioFetch.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise<void>((r) => res.once('drain', r));
          }
        }
        res.end();
      } catch (e: any) {
        reader.cancel().catch(() => {});
      }
      return;
    }

    return res.status(404).json({ error: 'No playable track found in this style' });
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.post('/videos', async (req, res) => {
  try {
    const { title, topic, format, duration, language, animationModel, subtitleStyle, voice, clipDuration, subtitleFont, subtitleSize, subtitleColor, musicStyle, musicVolume, customScenario, landingUrl, additionalDetails, scriptMode, heygenAvatar } = req.body;
    if (!format || !duration) {
      return res.status(400).json({ error: 'format and duration are required' });
    }
    const hasTopic = topic && String(topic).trim().length > 0;
    const hasScenario = customScenario && String(customScenario).trim().length > 10;
    const hasLandingUrl = landingUrl && String(landingUrl).trim().length > 5;
    if (!hasTopic && !hasScenario && !hasLandingUrl) {
      return res.status(400).json({ error: 'topic, customScenario, or landingUrl is required' });
    }
    const validFormats: VideoFormat[] = ['9:16', '16:9', '1:1'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: 'format must be one of: 9:16, 16:9, 1:1' });
    }
    if (hasTopic && String(topic).trim().length > 500) {
      return res.status(400).json({ error: 'topic must be 500 characters or less' });
    }
    if (hasScenario && String(customScenario).trim().length > 5000) {
      return res.status(400).json({ error: 'customScenario must be 5000 characters or less' });
    }
    if (additionalDetails && String(additionalDetails).trim().length > 1000) {
      return res.status(400).json({ error: 'additionalDetails must be 1000 characters or less' });
    }
    const effectiveTopic = hasTopic ? String(topic).trim() : 'Пользовательский сценарий';
    const project = await createProject({
      title: (title && String(title).trim()) || effectiveTopic,
      topic: effectiveTopic,
      format,
      duration: Number(duration),
      language: language || 'ru',
      animationModel: ALL_MODELS.includes(animationModel) ? animationModel : 'wan',
      subtitleStyle: VALID_SUBTITLE_STYLES.includes(subtitleStyle) ? subtitleStyle : (format === '9:16' ? 'tiktok' : 'karaoke'),
      voice: (voice && VALID_VOICES.has(voice)) ? voice : undefined,
      // Fixed-duration models (Veo 3.1 = ~8s) ignore clipDuration — clearing it
      // prevents a stray 5/10 from overriding the model's real clip length and
      // desyncing scene layout, narration pacing, and assembly.
      clipDuration: FIXED_DURATION_MODELS.has(animationModel) ? undefined : ((clipDuration === 5 || clipDuration === 10) ? clipDuration : undefined),
      subtitleFont: subtitleFont ? String(subtitleFont) : undefined,
      subtitleSize: ['small','medium','large','xlarge'].includes(subtitleSize) ? subtitleSize : undefined,
      subtitleColor: subtitleColor && /^#[0-9a-fA-F]{6}$/.test(subtitleColor) ? subtitleColor : undefined,
      musicStyle: typeof musicStyle === 'string' ? musicStyle : undefined,
      musicVolume: (typeof musicVolume === 'number' && musicVolume >= 0 && musicVolume <= 1) ? musicVolume : undefined,
      customScenario: hasScenario ? String(customScenario).trim() : undefined,
      landingUrl: hasLandingUrl ? String(landingUrl).trim() : undefined,
      additionalDetails: (additionalDetails && String(additionalDetails).trim()) ? String(additionalDetails).trim() : undefined,
      scriptMode: scriptMode === 'viral' ? 'viral' : (format === '9:16' ? 'viral' : undefined),
      heygenAvatar: (typeof heygenAvatar === 'string' && heygenAvatar.trim()) ? heygenAvatar.trim().slice(0, 120) : undefined,
    });
    res.status(201).json(project);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AI-режиссёр: по брифу/теме предлагает план настроек видео (не запускает генерацию).
router.post('/videos/plan', async (req, res) => {
  const { brief, topic, customScenario, landingUrl, additionalDetails } = req.body ?? {};
  const hasInput = [brief, topic, customScenario, landingUrl].some((v) => v && String(v).trim().length > 0);
  if (!hasInput) {
    return res.status(400).json({ error: 'Нужен бриф, тема, сценарий или ссылка на лендинг' });
  }
  try {
    await ensureKeysLoaded();
    const plan = await planVideo({ brief, topic, customScenario, landingUrl, additionalDetails });
    res.json(plan);
  } catch (err: any) {
    console.error('[director] plan failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/videos/:id', async (req, res) => {
  try {
    const ok = await deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/videos/:id/download', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.status !== 'done' || !project.videoPath) {
      return res.status(400).json({ error: 'Video not ready' });
    }
    if (!hasVideoFile(project)) {
      return res.status(404).json({ error: 'Video file missing', missing: true });
    }
    res.download(project.videoPath, `${project.title.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_')}.mp4`);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Thumbnail: extract first frame from local video file, cache as JPEG
router.get('/videos/:id/thumbnail', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.videoPath) return res.status(404).json({ error: 'No video file' });

    // Safety: only replace .mp4 extension to avoid overwriting video files
    if (!project.videoPath.endsWith('.mp4')) {
      return res.status(404).json({ error: 'Unsupported video format' });
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { renameSync } = await import('fs');

    // Cache thumbnail next to video file
    const thumbPath = project.videoPath.replace(/\.mp4$/, '_thumb.jpg');

    if (!existsSync(thumbPath)) {
      if (!hasVideoFile(project)) {
        return res.status(404).json({ error: 'Video file missing' });
      }
      // Write to temp file first, then rename atomically
      // Extension must be .jpg so ffmpeg detects the format
      const tmpPath = thumbPath.replace(/\.jpg$/, `.${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
      try {
        await execFileAsync('ffmpeg', [
          '-i', project.videoPath,
          '-ss', '1',
          '-vframes', '1',
          '-vf', 'scale=320:-1',
          '-q:v', '5',
          '-y',
          tmpPath,
        ]);
        renameSync(tmpPath, thumbPath);
      } catch (ffmpegErr) {
        // Clean up temp file on failure
        try { const { unlinkSync } = await import('fs'); unlinkSync(tmpPath); } catch {}
        return res.status(500).json({ error: 'Thumbnail extraction failed' });
      }
    }

    // res.sendFile with error callback — does not crash on missing/corrupt file
    const absThumbPath = path.resolve(thumbPath);
    res.sendFile(absThumbPath, { maxAge: '1d' }, (sendErr) => {
      if (sendErr && !res.headersSent) {
        res.status(404).json({ error: 'Thumbnail not available' });
      }
    });
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Serve TTS audio preview for a specific scene (generated alongside script)
router.get('/videos/:id/audio/:sceneIndex', async (req, res) => {
  const { id, sceneIndex } = req.params;
  const idx = parseInt(sceneIndex, 10);
  if (isNaN(idx) || idx < 0 || idx > 99) return res.status(400).json({ error: 'Invalid index' });
  const audioPath = path.join(DATA_PATHS.imagesDir(id), 'audio', `scene_${idx}.mp3`);
  try {
    await fs.access(audioPath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    const { createReadStream } = await import('fs');
    createReadStream(audioPath).pipe(res as any);
  } catch {
    res.status(404).json({ error: 'Audio not ready' });
  }
});

// Reset project to script_ready so video can be regenerated (e.g. file lost after restart)
router.post('/videos/:id/reset', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    await updateProject(req.params.id, {
      status: 'script_ready',
      progress: 10,
      progressMessage: 'Сценарий готов — нажмите «Генерировать видео»',
      videoPath: undefined,
      videoUrl: undefined,
      error: undefined,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate only the script (step 1), then pause for user review
router.post('/videos/:id/generate-script', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (['generating_script', 'generating_images', 'animating', 'assembling'].includes(project.status)) {
      return res.status(409).json({ error: 'Already generating' });
    }

    res.json({ success: true, message: 'Script generation started' });

    runScriptOnly(project.id).catch((err) => {
      console.error('[video-gen] Script generation error:', err);
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update a single scene's text (for user editing before generation)
// Retry stock search for one scene (optionally with a new query)
router.post('/videos/:id/scenes/:sceneIndex/stock-retry', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project?.script) return res.status(404).json({ error: 'Not found' });

    const sceneIndex = parseInt(req.params.sceneIndex, 10);
    const scene = project.script.scenes[sceneIndex];
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const newQuery: string | undefined = typeof req.body.stockQuery === 'string'
      ? req.body.stockQuery.trim() : undefined;

    const query = newQuery || scene.stockQuery || scene.imagePrompt || scene.text;
    const clipsDir = path.join(DATA_PATHS.imagesDir(project.id), 'clips');
    await fs.mkdir(clipsDir, { recursive: true });
    const clipPath = path.join(clipsDir, `clip_${sceneIndex}.mp4`);

    // Remove stale clip if any
    await fs.unlink(clipPath).catch(() => {});

    let available = false;
    try {
      await searchAndDownloadStockClip({
        query,
        outputPath: clipPath,
        durationSeconds: project.clipDuration ?? scene.duration,
        format: project.format,
      });
      available = true;
      console.log(`[stock-retry] Scene ${sceneIndex + 1}: ✓ found "${query.slice(0, 50)}"`);
    } catch (err: any) {
      console.log(`[stock-retry] Scene ${sceneIndex + 1}: ✗ not found`);
    }

    const updatedScenes = project.script.scenes.map((s, i) => {
      if (i !== sceneIndex) return s;
      return {
        ...s,
        stockQuery: newQuery || s.stockQuery,
        stockAvailable: available,
        videoSource: available ? 'stock' as const : 'ai' as const,
      };
    });
    await updateProject(project.id, { script: { ...project.script, scenes: updatedScenes } });

    res.json({ available, videoSource: available ? 'stock' : 'ai' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Translates text using DeepSeek → OpenAI → Gemini fallback chain
async function translateText(text: string, direction: 'ru-to-en' | 'en-to-ru'): Promise<string> {
  const system = direction === 'en-to-ru'
    ? 'Translate the following text from English to Russian. Return ONLY the translated text, no explanations, no quotes.'
    : 'Translate the following text from Russian to English. Return ONLY the translated text, no explanations, no quotes.';

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: text }], max_tokens: 500, temperature: 0.3 }),
    });
    const data = await res.json() as any;
    const result = data.choices?.[0]?.message?.content?.trim();
    if (result) return result;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: text }], max_tokens: 500, temperature: 0.3 }),
    });
    const data = await res.json() as any;
    const result = data.choices?.[0]?.message?.content?.trim();
    if (result) return result;
  }

  throw new Error('No AI key available for translation');
}

router.patch('/videos/:id/scenes/:sceneId', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });

    const { text, t2vPrompt, imagePrompt, narration, selectedVariant, videoSource, stockQuery, imagePromptRu, t2vPromptRu, duration: sceneDuration } = req.body;

    if (selectedVariant !== undefined) {
      const sv = Number(selectedVariant);
      if (!Number.isInteger(sv) || sv < 0 || sv > 3) {
        return res.status(400).json({ error: 'selectedVariant must be 0, 1, 2, or 3' });
      }
    }

    let translatedImagePrompt: string | undefined;
    let translatedT2vPrompt: string | undefined;

    // When Russian prompt is saved, back-translate to English for AI generation
    if (typeof imagePromptRu === 'string' && imagePromptRu.trim()) {
      try { translatedImagePrompt = await translateText(imagePromptRu.trim(), 'ru-to-en'); } catch { /* use old EN */ }
    }
    if (typeof t2vPromptRu === 'string' && t2vPromptRu.trim()) {
      try { translatedT2vPrompt = await translateText(t2vPromptRu.trim(), 'ru-to-en'); } catch { /* use old EN */ }
    }

    const sceneExists = project.script.scenes.some(s => s.id === req.params.sceneId);
    if (!sceneExists) return res.status(404).json({ error: 'Scene not found' });

    const scenes = project.script.scenes.map((s) => {
      if (s.id !== req.params.sceneId) return s;
      const updated: any = { ...s };
      if (typeof text === 'string') updated.text = text.trim();
      if (typeof t2vPrompt === 'string') updated.t2vPrompt = t2vPrompt.trim();
      if (typeof imagePrompt === 'string') updated.imagePrompt = imagePrompt.trim();
      if (typeof narration === 'string') updated.narration = narration.trim();
      if (typeof selectedVariant === 'number') updated.selectedVariant = selectedVariant;
      if (videoSource === 'ai' || videoSource === 'stock' || videoSource === 'stock-animated' || videoSource === 'avatar') updated.videoSource = videoSource;
      if (typeof stockQuery === 'string') updated.stockQuery = stockQuery.trim();
      if (typeof imagePromptRu === 'string') updated.imagePromptRu = imagePromptRu.trim();
      if (typeof t2vPromptRu === 'string') updated.t2vPromptRu = t2vPromptRu.trim();
      if (translatedImagePrompt) updated.imagePrompt = translatedImagePrompt;
      if (translatedT2vPrompt) updated.t2vPrompt = translatedT2vPrompt;
      if (typeof sceneDuration === 'number' && sceneDuration > 0 && sceneDuration <= 60) updated.duration = sceneDuration;
      return updated;
    });
    const updatedScript = { ...project.script, scenes };
    await updateProject(req.params.id, { script: updatedScript });
    res.json({ success: true, imagePrompt: translatedImagePrompt, t2vPrompt: translatedT2vPrompt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Translate scene's English prompt → Russian, save as imagePromptRu / t2vPromptRu
router.post('/videos/:id/scenes/:sceneIndex/translate-prompt', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project?.script) return res.status(404).json({ error: 'Not found' });
    const idx = parseInt(req.params.sceneIndex, 10);
    const scene = project.script.scenes[idx];
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const isT2V = !!scene.t2vPrompt;
    const enText = isT2V ? (scene.t2vPrompt || '') : (scene.imagePrompt || '');
    if (!enText) return res.status(400).json({ error: 'No prompt to translate' });

    const ruText = await translateText(enText, 'en-to-ru');

    const scenes = project.script.scenes.map((s, i) => {
      if (i !== idx) return s;
      return isT2V ? { ...s, t2vPromptRu: ruText } : { ...s, imagePromptRu: ruText };
    });
    await updateProject(req.params.id, { script: { ...project.script, scenes } });
    res.json({ success: true, imagePromptRu: isT2V ? undefined : ruText, t2vPromptRu: isT2V ? ruText : undefined });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Login via Directus (for cross-domain use when main app token is unavailable)
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const { getDirectusBaseUrl } = await import('./load-keys.js');
    const directusUrl = getDirectusBaseUrl();
    const resp = await fetch(`${directusUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json() as any;
    if (!resp.ok) {
      return res.status(401).json({ error: data?.errors?.[0]?.message || 'Неверный email или пароль' });
    }
    res.json({
      token: data.data?.access_token,
      refresh_token: data.data?.refresh_token,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy: fetch user's campaigns from Directus using admin token + user_id filter from JWT
router.get('/campaigns-proxy', async (req, res) => {
  try {
    const { getDirectusBaseUrl, getDirectusToken } = await import('./load-keys.js');
    const directusUrl = getDirectusBaseUrl();
    const adminToken = getDirectusToken();
    if (!adminToken) return res.status(503).json({ error: 'Admin token not configured' });

    // Decode user_id from the user's JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    let userId: string | null = null;
    try {
      const payload = JSON.parse(Buffer.from(authHeader.slice(7).split('.')[1], 'base64').toString());
      userId = payload.id || null;
    } catch { /* ignore */ }
    if (!userId) return res.status(401).json({ error: 'Invalid token' });

    const url = `${directusUrl}/items/user_campaigns?filter[user_id][_eq]=${userId}&fields=id,name&limit=100&sort=name`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: `Directus ${resp.status}: ${text.slice(0, 200)}` });
    }
    const data = await resp.json() as any;
    res.json({ success: true, data: data.data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save completed video to a campaign in the main SMM manager (via Directus)
router.post('/videos/:id/save-to-campaign', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.status !== 'done') return res.status(400).json({ error: 'Video not ready' });

    const { campaignId, appUrl, contentType } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });

    const { getDirectusBaseUrl, getDirectusToken } = await import('./load-keys.js');
    const directusUrl = getDirectusBaseUrl();
    const adminToken = getDirectusToken();
    if (!adminToken) return res.status(503).json({ error: 'Directus token not available' });

    // Decode user_id from the user's JWT (works even if expired — we only read the payload)
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = JSON.parse(Buffer.from(authHeader.slice(7).split('.')[1], 'base64').toString());
        userId = payload.id || null;
      } catch { /* ignore */ }
    }

    // Upload video to S3 for a permanent URL. If upload fails, reject the save
    // rather than silently writing a local link that will stop working.
    let videoUrl: string | null = null;

    const localVideoPath = DATA_PATHS.videoFile(req.params.id);
    const fileExists = existsSync(localVideoPath);
    console.log(`[save-to-campaign] video file exists=${fileExists} path=${localVideoPath}`);
    console.log(`[save-to-campaign] S3 env: BUCKET=${process.env.BEGET_S3_BUCKET} KEY=${process.env.BEGET_S3_ACCESS_KEY ? 'SET' : 'MISSING'}`);
    if (fileExists) {
      try {
        const { uploadVideoToS3 } = await import('./services/s3-upload.js');
        const s3Result = await uploadVideoToS3(localVideoPath, req.params.id);
        videoUrl = s3Result.url;
        console.log(`[save-to-campaign] Uploaded to S3: ${videoUrl}`);
      } catch (s3Err: unknown) {
        const msg = s3Err instanceof Error ? s3Err.message : String(s3Err);
        console.error(`[save-to-campaign] S3 upload FAILED: ${msg}`);
        return res.status(502).json({ error: `S3 upload failed: ${msg}` });
      }
    } else {
      console.warn(`[save-to-campaign] Video file not found at ${localVideoPath}`);
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    // Build content text from scene narrations/texts + topic prompt
    let contentText = '';
    if (project.script?.scenes?.length) {
      contentText = project.script.scenes
        .map((s: any, i: number) => {
          const text = (s.narration || s.text || '').trim();
          return text ? `${i + 1}. ${text}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
    if (!contentText) contentText = project.topic || '';

    const body: Record<string, unknown> = {
      campaign_id: campaignId,
      title: project.title || project.topic,
      content: contentText,
      prompt: project.topic || '',
      content_type: contentType === 'video' ? 'video' : 'clip',
      video_url: videoUrl,
      status: 'draft',
    };
    if (userId) body.user_id = userId;

    const resp = await fetch(`${directusUrl}/items/campaign_content`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ error: `Directus error ${resp.status}: ${text.slice(0, 200)}` });
    }

    const data = await resp.json() as any;
    res.json({ success: true, contentId: data.data?.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a custom start frame for an I2V scene (saved as variant index 3)
router.post('/videos/:id/scenes/:sceneIndex/upload-frame', async (req, res) => {
  try {
    const { id, sceneIndex } = req.params;
    const idx = parseInt(sceneIndex, 10);
    if (isNaN(idx) || idx < 0 || idx > 99) return res.status(400).json({ error: 'Invalid scene index' });

    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'imageBase64 required' });

    const project = await getProject(id);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Decode base64 (strip data URI prefix if present)
    const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const inputBuf = Buffer.from(base64Data, 'base64');

    const variantsDir = path.join(DATA_PATHS.imagesDir(id), 'variants');
    await fs.mkdir(variantsDir, { recursive: true });
    const outputPath = path.join(variantsDir, `scene_${idx}_v3.jpg`);

    // Convert to JPEG via sharp (normalise any format)
    const { default: sharp } = await import('sharp');
    await sharp(inputBuf).jpeg({ quality: 92 }).toFile(outputPath);

    // Auto-select variant 3 in the scene
    if (project.script) {
      const scenes = project.script.scenes.map((s, i) =>
        i === idx ? { ...s, selectedVariant: 3 } : s
      );
      await updateProject(id, { script: { ...project.script, scenes } });
    }

    res.json({ success: true, variant: 3 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── New scene-level routes ─────────────────────────────────────────────────────

// Delete a scene
router.delete('/videos/:id/scenes/:sceneIndex', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });
    const idx = parseInt(req.params.sceneIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= project.script.scenes.length) {
      return res.status(400).json({ error: 'Invalid scene index' });
    }
    if (project.script.scenes.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only scene' });
    }
    const scenes = project.script.scenes.filter((_, i) => i !== idx);
    await updateProject(req.params.id, { script: { ...project.script, scenes } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add a blank scene
router.post('/videos/:id/scenes', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });
    const { insertAt } = req.body;
    const newScene: Scene = {
      id: crypto.randomUUID(),
      text: 'Новая сцена',
      imagePrompt: 'A cinematic scene',
      stockQuery: 'cinematic',
      videoSource: 'ai',
      duration: project.clipDuration ?? 5,
    };
    const scenes = [...project.script.scenes];
    const pos = (typeof insertAt === 'number' && insertAt >= 0 && insertAt <= scenes.length) ? insertAt : scenes.length;
    scenes.splice(pos, 0, newScene);
    await updateProject(req.params.id, { script: { ...project.script, scenes } });
    res.status(201).json({ success: true, insertedAt: pos });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder scenes
router.post('/videos/:id/scenes/reorder', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });
    const { order } = req.body; // array of new indices e.g. [2,0,1]
    if (!Array.isArray(order) || order.length !== project.script.scenes.length) {
      return res.status(400).json({ error: 'order must be an array with same length as scenes' });
    }
    const scenes = order.map((i: number) => project.script!.scenes[i]);
    await updateProject(req.params.id, { script: { ...project.script, scenes } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Re-animate a single scene (redo FAL.AI call for that scene)
router.post('/videos/:id/scenes/:sceneIndex/reanimate', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getProject(id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });
    const idx = parseInt(req.params.sceneIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= project.script.scenes.length) {
      return res.status(400).json({ error: 'Invalid scene index' });
    }
    const scene = project.script.scenes[idx];
    const imagesDir = DATA_PATHS.imagesDir(id);
    const clipsDir = path.join(imagesDir, 'clips');
    await fs.mkdir(clipsDir, { recursive: true });
    const clipPath = path.join(clipsDir, `clip_${idx}.mp4`);
    const model = project.animationModel as any;
    const dur = project.clipDuration ?? (scene as any).duration ?? 5;
    const { format } = project;

    res.json({ success: true, message: 'Reanimate started' });

    // Run async
    (async () => {
      type SceneStatusVal = 'pending' | 'animating' | 'done' | 'error';
      const sceneStatuses: Record<number, SceneStatusVal> = { ...(project.script!.sceneStatuses ?? {}), [idx]: 'animating' as SceneStatusVal };
      await updateProject(id, { script: { ...project.script!, sceneStatuses } });
      try {
        if (scene.videoSource !== 'stock') {
          const variantIdx = (scene as any).selectedVariant ?? 0;
          const variantPath = path.join(imagesDir, 'variants', `scene_${idx}_v${variantIdx}.jpg`);
          const fallbackPath = path.join(imagesDir, `scene_${idx}_v0.jpg`);
          const imgPath = existsSync(variantPath) ? variantPath : (existsSync(fallbackPath) ? fallbackPath : null);

          if (scene.videoSource === 'stock-animated' || !imgPath) {
            await animateText({ prompt: scene.imagePrompt, outputPath: clipPath, model, durationSeconds: dur, format });
          } else {
            const imageBuffer = await fs.readFile(imgPath);
            await animateFrame({ imageBuffer, prompt: scene.imagePrompt, outputPath: clipPath, model, durationSeconds: dur, format });
          }
        }
        const fresh = await getProject(id);
        const doneStatuses: Record<number, SceneStatusVal> = { ...(fresh?.script?.sceneStatuses ?? {}), [idx]: 'done' as SceneStatusVal };
        await updateProject(id, { script: { ...fresh!.script!, sceneStatuses: doneStatuses } });
      } catch (e: any) {
        const fresh = await getProject(id);
        const errStatuses: Record<number, SceneStatusVal> = { ...(fresh?.script?.sceneStatuses ?? {}), [idx]: 'error' as SceneStatusVal };
        await updateProject(id, { script: { ...fresh!.script!, sceneStatuses: errStatuses } });
        console.error(`[reanimate] scene ${idx} error:`, e.message);
      }
    })().catch(console.error);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate TTS audio for a single scene
router.post('/videos/:id/scenes/:sceneIndex/regenerate-audio', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getProject(id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });
    const idx = parseInt(req.params.sceneIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= project.script.scenes.length) {
      return res.status(400).json({ error: 'Invalid scene index' });
    }
    const scene = project.script.scenes[idx];
    const imagesDir = DATA_PATHS.imagesDir(id);
    await fs.mkdir(path.join(imagesDir, 'audio'), { recursive: true });
    const audioPath = path.join(imagesDir, 'audio', `scene_${idx}.mp3`);
    await generateAudio({
      text: scene.narration || scene.text,
      language: project.language,
      outputPath: audioPath,
      targetDuration: project.clipDuration ?? (scene as any).duration ?? 5,
      voice: project.voice,
    });
    res.json({ success: true, message: 'Audio regenerated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resume pipeline from the furthest completed stage
router.post('/videos/:id/resume', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (['generating_script', 'generating_images', 'animating', 'assembling'].includes(project.status)) {
      return res.status(409).json({ error: 'Already generating' });
    }
    if (!project.script) return res.status(400).json({ error: 'No script — restart from scratch' });

    // mode='rebuild' → full re-assembly from saved clips+audio, ignoring any
    // existing (possibly corrupt) final MP4. mode='auto' (default) re-burns
    // subtitles when the final video is valid, else falls back to re-assembly.
    const mode: 'auto' | 'rebuild' = req.body?.mode === 'rebuild' ? 'rebuild' : 'auto';

    // Flip to 'assembling' synchronously BEFORE responding so polling clients
    // never observe the stale previous 'done'/'error' status while the async
    // pipeline spins up (also makes the 409 double-click guard effective).
    await updateProject(project.id, {
      status: 'assembling', progress: 76,
      progressMessage: mode === 'rebuild' ? 'Пересборка из сохранённых материалов...' : 'Определяю с какого места продолжить...',
    });

    res.json({ success: true });

    // Determine resume point asynchronously
    runResumePipeline(project.id, mode).catch(async (err) => {
      console.error('[resume] Pipeline error (outer catch):', err);
      await updateProject(project.id, {
        status: 'error',
        error: err?.message ?? String(err),
        progressMessage: `Ошибка resume: ${err?.message ?? String(err)}`,
      }).catch((e) => console.error('[resume] Failed to record pipeline error:', e));
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function applyMusic(projectId: string, videoPath: string, topic: string, scenes: { duration: number }[], clipDuration?: number, musicStyle?: string, scriptMode?: string, musicVolume?: number): Promise<void> {
  const plannedTotal = scenes.reduce((s, sc) => s + (clipDuration ?? sc.duration), 0);
  // Music must cover the ACTUAL assembled video. Clip lengths are driven by the
  // natural TTS duration (usually longer than planned), so a planned-sum target
  // leaves the last scene silent. Probe the finished file; +1s safety margin.
  const probedVideoDur = await probeActualDuration(videoPath);
  const totalDuration = (probedVideoDur > 0 ? probedVideoDur : plannedTotal) + 1;
  const musicPath = videoPath.replace(/\.mp4$/, '_bg_music.mp3');
  // Auto-select music style from topic when user hasn't chosen one
  const effectiveMusicStyle = musicStyle ?? autoMusicStyle(topic);
  const musicFile = await generateBackgroundMusic({ style: effectiveMusicStyle, outputPath: musicPath, targetDurationSec: totalDuration });
  if (musicFile) {
    await mixBackgroundMusic({ videoPath, musicPath: musicFile, musicVolume });
    await fs.unlink(musicPath).catch(() => {});
  }
}

async function runResumePipeline(projectId: string, mode: 'auto' | 'rebuild' = 'auto') {
  const project = await getProject(projectId);
  if (!project?.script) return;

  const imagesDir = DATA_PATHS.imagesDir(projectId);
  const videoPath = DATA_PATHS.videoFile(projectId);
  const clipsDir = path.join(imagesDir, 'clips');
  const audioDir = path.join(imagesDir, 'audio');
  const tempDir = path.join(imagesDir, '_temp');
  const script = project.script;

  const update = (p: Partial<typeof project>) => updateProject(projectId, p);

  try {
    // ── Stage 1: VALID assembled video exists → only re-burn subtitles ───────
    // mode='rebuild' forces full re-assembly from clips, skipping Stage 1.
    // Otherwise: fs.access only proves the file exists — an interrupted assembly
    // leaves a truncated MP4 (moov atom not found). probeActualDuration returns 0
    // for corrupt/0-byte files, so we burn subtitles ONLY onto a playable video.
    // A corrupt file is deleted so we fall through to Stage 2 (re-assemble).
    let assembledValid = false;
    if (mode !== 'rebuild') {
      try {
        await fs.access(videoPath);
        const existingDur = await probeActualDuration(videoPath);
        assembledValid = existingDur > 0;
        if (!assembledValid) {
          console.warn(`[resume] Existing ${path.basename(videoPath)} is corrupt (duration=0) — removing, will re-assemble from clips`);
          await fs.unlink(videoPath).catch(() => {});
        }
      } catch {}
    }

    // Check ALL clips exist (not just clip_0 — partial downloads break ffmpeg).
    let clipsExist = false;
    try {
      const clipChecks = await Promise.all(
        script.scenes.map((_, i) => fs.access(path.join(clipsDir, `clip_${i}.mp4`)).then(() => true).catch(() => false))
      );
      clipsExist = clipChecks.every(Boolean);
      if (!clipsExist) {
        const missing = clipChecks.map((ok, i) => !ok ? i : -1).filter(i => i >= 0);
        console.warn(`[resume] Missing clips: ${missing.map(i => `clip_${i}.mp4`).join(', ')} — cannot skip to assembly`);
      }
    } catch {}

    const stage = decideResumeStage({ mode, assembledValid, clipsExist });
    console.log(`[resume] ${projectId}: mode=${mode} assembledValid=${assembledValid} clipsExist=${clipsExist} → stage=${stage}`);

    // ── reburn: valid final video exists → only re-burn subtitles ────────────
    if (stage === 'reburn') {
      await update({ status: 'assembling', progress: 96, progressMessage: 'Накладываю субтитры (resume)...' });
      const scenes = script.scenes.map((s, i) => ({
        narration: s.narration || s.text,
        text: s.text,
        duration: project.clipDuration ?? s.duration,
        // Point at the existing per-scene audio so 'word-timed' can re-align on resume.
        audioPath: path.join(audioDir, `scene_${i}.mp3`),
      }));
      await burnSubtitlesSynced({
        videoPath,
        scenes,
        format: project.format,
        style: project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
        options: {
          font: (project as any).subtitleFont,
          sizeMultiplier: subtitleSizeMultiplier((project as any).subtitleSize),
          color: (project as any).subtitleColor,
        },
      });
      await waitForFile(videoPath);
      await update({
        status: 'done', progress: 100, progressMessage: 'Готово!',
        videoPath, videoUrl: `/video-app/api/videos/${projectId}/download`,
      });
      console.log(`[resume] Subtitles applied: ${projectId}`);
      return;
    }

    // ── reassemble: clips exist → reconstruct clipsWithAudio, assemble + burn ──
    if (stage === 'reassemble') {
      await update({ status: 'assembling', progress: 78, progressMessage: 'Склеиваю клипы (resume)...' });

      const clipsWithAudio = await Promise.all(
        script.scenes.map(async (s, i) => {
          const clipPath = path.join(clipsDir, `clip_${i}.mp4`);
          const audioPath = path.join(audioDir, `scene_${i}.mp3`);
          let hasAudio = false;
          try { await fs.access(audioPath); hasAudio = true; } catch {}
          // Probe the existing audio so clip length = voice length (prevents truncated
          // narration / desync on resume — same as the main generation paths).
          const audioDuration = hasAudio ? await probeActualDuration(audioPath) : undefined;
          return {
            clipPath,
            duration: project.clipDuration ?? s.duration,
            audioPath: hasAudio ? audioPath : undefined,
            audioDuration,
            narration: s.narration || s.text,
            text: s.text,
            role: s.role,
          };
        })
      );

      const resumeScenes = await maybeWithTitleCard(clipsWithAudio, project.format, tempDir);
      const resumeActualDurations = await assembleFromClips({
        scenes: resumeScenes,
        outputPath: videoPath,
        tempDir,
        format: project.format,
        crossfadeDuration: 0.5,
        flashCut: false,
        hookTextOverlay: true,
        onProgress: async (pct, msg) => {
          await updateProject(projectId, { progress: 78 + Math.round(pct * 0.18), progressMessage: msg });
        },
      });

      await update({ progress: 96, progressMessage: 'Накладываю субтитры...' });
      await burnSubtitlesSynced({
        videoPath,
        scenes: resumeScenes,
        format: project.format,
        style: project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
        options: {
          font: (project as any).subtitleFont,
          sizeMultiplier: subtitleSizeMultiplier((project as any).subtitleSize),
          color: (project as any).subtitleColor,
        },
        actualDurations: resumeActualDurations,
        crossfadeSec: 0.5,
      });

      await update({ progress: 98, progressMessage: 'Добавляю фоновую музыку...' });
      await applyMusic(projectId, videoPath, project.topic, script.scenes, project.clipDuration, project.musicStyle, project.scriptMode, project.musicVolume);
      await waitForFile(videoPath);
      await update({
        status: 'done', progress: 100, progressMessage: 'Готово!',
        videoPath, videoUrl: `/video-app/api/videos/${projectId}/download`,
      });
      console.log(`[resume] Assembly+subtitles complete: ${projectId}`);
      return;
    }

    // ── No clips found — cannot resume, tell user to restart ────────────────
    await update({ status: 'error', error: 'Нет готовых клипов для resume — запустите генерацию заново', progressMessage: 'Нет клипов для продолжения' });
  } catch (err: any) {
    console.error(`[resume] Failed for ${projectId}:`, err.message);
    await updateProject(projectId, { status: 'error', error: err.message, progressMessage: `Ошибка resume: ${err.message}` });
  }
}

// Fire-and-forget generation pipeline
router.post('/videos/:id/generate', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (['generating_script', 'generating_images', 'animating', 'assembling'].includes(project.status)) {
      return res.status(409).json({ error: 'Already generating' });
    }

    // Allow subtitle style override from request body (fixes pre-existing projects with wrong style)
    const { subtitleStyle } = req.body || {};
    if (subtitleStyle && VALID_SUBTITLE_STYLES.includes(subtitleStyle)) {
      await updateProject(req.params.id, { subtitleStyle });
    }

    res.json({ success: true, message: 'Generation started' });

    runGenerationPipeline(project.id).catch(async (err) => {
      console.error('[video-gen] Pipeline error (outer catch):', err);
      // If the inner catch in runGenerationPipeline itself failed, set error here.
      await updateProject(project.id, {
        status: 'error',
        error: err?.message ?? String(err),
        progressMessage: `Ошибка: ${err?.message ?? String(err)}`,
      }).catch((e) => console.error('[video-gen] Failed to record pipeline error:', e));
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve image variant for a scene
// Serve stock clip for a scene
router.get('/videos/:id/clips/:sceneIndex', async (req, res) => {
  const idx = parseInt(req.params.sceneIndex, 10);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  const clipPath = path.join(DATA_PATHS.imagesDir(req.params.id), 'clips', `clip_${idx}.mp4`);
  try {
    await fs.access(clipPath);
    const stat = await fs.stat(clipPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache');
    const { createReadStream } = await import('fs');
    createReadStream(clipPath).pipe(res as any);
  } catch {
    res.status(404).json({ error: 'Clip not found' });
  }
});

router.get('/videos/:id/images/:sceneIndex/:variant', async (req, res) => {
  const { id, sceneIndex, variant } = req.params;
  const idx = parseInt(sceneIndex, 10);
  const vIdx = parseInt(variant, 10);
  if (isNaN(idx) || isNaN(vIdx) || vIdx < 0 || vIdx > 2) return res.status(400).json({ error: 'Invalid params' });
  const imagePath = path.join(DATA_PATHS.imagesDir(id), 'variants', `scene_${idx}_v${vIdx}.jpg`);
  try {
    await fs.access(imagePath);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');
    const { createReadStream } = await import('fs');
    createReadStream(imagePath).pipe(res as any);
  } catch {
    res.status(404).json({ error: 'Image not found' });
  }
});

// Generate 3 image variants for a specific scene (synchronous — waits for all 3)
router.post('/videos/:id/scenes/:sceneIndex/generate-variants', async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (!project.script) return res.status(400).json({ error: 'No script' });

    const sceneIndex = parseInt(req.params.sceneIndex, 10);
    if (isNaN(sceneIndex) || sceneIndex < 0 || sceneIndex >= project.script.scenes.length) {
      return res.status(400).json({ error: 'Invalid scene index' });
    }

    const scene = project.script.scenes[sceneIndex];
    const variantsDir = path.join(DATA_PATHS.imagesDir(req.params.id), 'variants');
    await fs.mkdir(variantsDir, { recursive: true });

    console.log(`[variants] Generating 3 variants for scene ${sceneIndex}...`);
    await Promise.all([0, 1, 2].map(async (v) => {
      const outputPath = path.join(variantsDir, `scene_${sceneIndex}_v${v}.jpg`);
      if (scene.backgroundPrompt && scene.subjectPrompt) {
        await generateLayeredImage({
          backgroundPrompt: scene.backgroundPrompt,
          subjectPrompt: scene.subjectPrompt,
          format: project.format,
          outputPath,
          sceneText: scene.text,
        });
      } else {
        await generateImage({
          prompt: scene.imagePrompt,
          format: project.format,
          outputPath,
          sceneText: scene.text,
        });
      }
    }));

    console.log(`[variants] Scene ${sceneIndex}: 3 variants ready`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Background TTS preview — runs after script_ready, don't block UI ─────────
async function generateScriptAudio(projectId: string, script: Script, language: string, voice?: string, clipDuration?: number) {
  const audioDir = path.join(DATA_PATHS.imagesDir(projectId), 'audio');
  await fs.mkdir(audioDir, { recursive: true });
  await Promise.all(
    script.scenes.map(async (scene, i) => {
      const audioPath = path.join(audioDir, `scene_${i}.mp3`);
      try {
        await generateAudio({
          text: scene.narration || scene.text,
          language: language as 'ru' | 'en',
          outputPath: audioPath,
          targetDuration: clipDuration ?? scene.duration,
          voice,
        });
        console.log(`[tts] Preview scene ${i} ready`);
      } catch (err: any) {
        console.warn(`[tts] Preview scene ${i} failed: ${err.message}`);
      }
    })
  );
}

// ── Landing page scraper ──────────────────────────────────────────────────────
async function scrapeLandingPage(url: string): Promise<string> {
  console.log(`[scraper] Fetching: ${url}`);
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VideoBot/1.0)' },
  });
  if (!resp.ok) throw new Error(`Failed to fetch landing page ${url}: HTTP ${resp.status}`);
  const html = await resp.text();

  // Extract <title> and first <h1> before stripping tags — use as product name
  const titleMatch = html.match(/<title[^>]*>([^<]{3,120})<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]{3,120})<\/h1>/i);
  // Prefer <title> (has brand name like "SMM Manager - tagline"), fallback to <h1>
  const rawProductName = (titleMatch?.[1] ?? h1Match?.[1] ?? '').replace(/\s+/g, ' ').trim();

  // Extract hostname to sanitize from content (e.g. "omemo.tech")
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  // Strip HTML
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // Replace domain name occurrences with product name so AI doesn't rely on prior domain knowledge
  if (hostname && rawProductName) {
    const domainRe = new RegExp(hostname.replace('.', '\\.'), 'gi');
    text = text.replace(domainRe, rawProductName);
  }

  text = text.slice(0, 8000);
  console.log(`[scraper] Extracted ${text.length} chars, product="${rawProductName}", domain="${hostname}" replaced`);
  return text;
}

// ── Background stock precheck — runs after script_ready, checks Pexels for ALL scenes ──
// Video found → videoSource='stock'; Photo found → videoSource='stock-animated'; Nothing → videoSource='ai'
async function runStockPrecheck(projectId: string, script: Script, format: VideoFormat, clipDuration?: number) {
  const clipsDir = path.join(DATA_PATHS.imagesDir(projectId), 'clips');
  await fs.mkdir(clipsDir, { recursive: true });

  // HeyGen avatar (whole-video) mode: every scene is rendered as a talking avatar
  // lip-synced to its TTS — there is no stock or AI image to look for. Mark all
  // scenes 'avatar' and release the gate immediately.
  const proj = await getProject(projectId);
  if (proj?.animationModel === 'heygen-avatar') {
    const fresh = await getProject(projectId);
    if (fresh?.script) {
      const avatarScenes = fresh.script.scenes.map((s) => ({ ...s, videoSource: 'avatar' as const }));
      await updateProject(projectId, {
        script: { ...fresh.script, scenes: avatarScenes, stockPrechecked: true },
        status: 'script_ready',
        progress: 20,
        progressMessage: `Сценарий готов: ${avatarScenes.length} сцен — все озвучит аватар. Проверьте текст и нажмите «Генерировать видео».`,
      });
    }
    console.log(`[stock-precheck] ${projectId}: heygen-avatar — all scenes set to avatar, skipping stock`);
    return;
  }

  console.log(`[stock-precheck] Checking all ${script.scenes.length} scene(s) for project ${projectId}`);

  // Run all checks in parallel, collect results
  // For each scene: try stock video → try stock photo → fallback to AI generation
  const results: { i: number; available: boolean; photoAvailable: boolean }[] = await Promise.all(
    script.scenes.map(async (s, i) => {
      const query = s.stockQuery || s.imagePrompt || s.text;
      const clipPath = path.join(clipsDir, `clip_${i}.mp4`);
      const variantsDir = path.join(DATA_PATHS.imagesDir(projectId), 'variants');
      const photoPath = path.join(variantsDir, `scene_${i}_v0.jpg`);

      // If video clip already cached, reuse it
      try {
        await fs.access(clipPath);
        console.log(`[stock-precheck] Scene ${i + 1}: ✓ video already cached`);
        return { i, available: true, photoAvailable: false };
      } catch {}

      // Try stock video
      try {
        await searchAndDownloadStockClip({
          query,
          outputPath: clipPath,
          durationSeconds: clipDuration ?? s.duration,
          format,
        });
        console.log(`[stock-precheck] Scene ${i + 1}: ✓ video found "${query.slice(0, 50)}"`);
        return { i, available: true, photoAvailable: false };
      } catch {}

      // No video found — try stock photo (will be used as I2V source, variant 0)
      try {
        await fs.mkdir(variantsDir, { recursive: true });
        await searchAndDownloadStockPhoto({ query, outputPath: photoPath, format });
        console.log(`[stock-precheck] Scene ${i + 1}: 📷 photo found "${query.slice(0, 50)}"`);
        return { i, available: false, photoAvailable: true };
      } catch {}

      console.log(`[stock-precheck] Scene ${i + 1}: ✗ no stock found → AI generation`);
      return { i, available: false, photoAvailable: false };
    })
  );

  // Single DB update: set stockAvailable + stockPhotoAvailable + auto-switch videoSource
  const fresh = await getProject(projectId);
  if (!fresh?.script) {
    // No script to mark prechecked → can't satisfy the polling contract; surface as error.
    await updateProject(projectId, { status: 'error', error: 'Сценарий не найден при проверке стоков', progressMessage: 'Ошибка: сценарий не найден.' });
    return;
  }

  const updatedScenes = fresh.script.scenes.map((s, i) => {
    const r = results.find((x) => x.i === i);
    if (!r) return s;
    const videoSource: Scene['videoSource'] = r.available ? 'stock' : r.photoAvailable ? 'stock-animated' : 'ai';
    return {
      ...s,
      stockAvailable: r.available,
      videoSource,
      stockPhotoAvailable: r.photoAvailable,
      // Pre-select variant 0 if a stock photo was found (so I2V has a ready image)
      selectedVariant: (!r.available && r.photoAvailable) ? 0 : s.selectedVariant,
    };
  });

  const foundVideo = results.filter((r) => r.available).length;
  const foundPhoto = results.filter((r) => !r.available && r.photoAvailable).length;
  const aiCount = script.scenes.length - foundVideo - foundPhoto;

  // Release the gate → 'script_ready' now that every scene has an accurate source.
  await updateProject(projectId, {
    script: { ...fresh.script, scenes: updatedScenes, stockPrechecked: true },
    status: 'script_ready',
    progress: 20,
    progressMessage: `Готово: ${foundVideo} видео, ${foundPhoto} фото, ${aiCount} AI. Проверьте сценарий и выберите источник.`,
  });

  console.log(`[stock-precheck] Done for ${projectId}: ${foundVideo} video, ${foundPhoto} photo, ${aiCount} AI`);

  // Auto-generate 3 image variants only for scenes with no stock at all
  const aiScenes = results.filter((r) => !r.available && !r.photoAvailable);
  if (aiScenes.length > 0) {
    const freshProject = await getProject(projectId);
    if (freshProject?.script) {
      console.log(`[stock-precheck] Auto-generating variants for ${aiScenes.length} AI scene(s)...`);
      await Promise.all(aiScenes.map(async ({ i }) => {
        const scene = freshProject.script!.scenes[i];
        const variantsDir = path.join(DATA_PATHS.imagesDir(projectId), 'variants');
        await fs.mkdir(variantsDir, { recursive: true });
        try {
          await Promise.all([0, 1, 2].map(async (v) => {
            const outputPath = path.join(variantsDir, `scene_${i}_v${v}.jpg`);
            if (scene.backgroundPrompt && scene.subjectPrompt) {
              await generateLayeredImage({ backgroundPrompt: scene.backgroundPrompt, subjectPrompt: scene.subjectPrompt, format: freshProject.format, outputPath, sceneText: scene.text });
            } else {
              await generateImage({ prompt: scene.imagePrompt, format: freshProject.format, outputPath, sceneText: scene.text });
            }
          }));
          console.log(`[stock-precheck] Scene ${i + 1}: variants ready`);
        } catch (err: any) {
          console.warn(`[stock-precheck] Scene ${i + 1} variants failed: ${err.message}`);
        }
      }));
    }
  }
}

// ── Script-only step (for preview before video generation) ────────────────────
async function runScriptOnly(projectId: string) {
  try {
    await ensureKeysLoaded();
    const project = await getProject(projectId);
    if (!project) throw new Error('Project not found');

    // HeyGen video-agent has no scene script — a single prompt produces the whole
    // video. Skip script generation entirely and run the generation pipeline,
    // which short-circuits to the agent path.
    if (project.animationModel === 'heygen-agent') {
      console.log(`[video-gen] ${projectId}: heygen-agent — skipping script, running agent pipeline`);
      await runGenerationPipeline(projectId);
      return;
    }

    await updateProject(projectId, { status: 'generating_script', progress: 5, progressMessage: 'Генерирую сценарий...' });

    let landingPageContent: string | undefined;
    if (project.landingUrl) {
      try {
        await updateProject(projectId, { progressMessage: `Загружаю лендинг: ${project.landingUrl}...` });
        landingPageContent = await scrapeLandingPage(project.landingUrl);
      } catch (err: any) {
        console.warn(`[script-gen] Landing page scrape failed: ${err.message} — proceeding without content`);
      }
    }

    const useT2V = isT2VModel(project.animationModel);
    const script = await generateScript({
      topic: project.topic,
      format: project.format,
      duration: project.duration,
      language: project.language,
      customScenario: project.customScenario,
      landingPageContent,
      t2v: useT2V,
      animationModel: project.animationModel,
      clipDuration: project.clipDuration,
      additionalDetails: project.additionalDetails,
      scriptMode: project.scriptMode,
    });

    // Hold the user on a "searching stock" gate while the precheck scours stock
    // sources for every scene. Only after that do we move to 'script_ready', so
    // the AI/Stock choice the user sees is already accurate (not still loading).
    await updateProject(projectId, {
      script,
      status: 'searching_stock',
      progress: 15,
      progressMessage: `Сценарий готов — ${script.scenes.length} сцен. Подбираю стоковые видео и фото под каждую сцену...`,
    });

    console.log(`[video-gen] Script ready for ${projectId}: ${script.scenes.length} scenes — searching stock`);

    // Fire TTS in background so user can preview audio once script review opens
    generateScriptAudio(projectId, script, project.language, project.voice, project.clipDuration).catch((err) => {
      console.warn(`[tts] Background preview failed for ${projectId}: ${err.message}`);
    });

    // Stock precheck — checks all stock sources per scene. It transitions the
    // project to 'script_ready' when finished (or on failure), releasing the gate.
    runStockPrecheck(projectId, script, project.format, project.clipDuration).catch(async (err) => {
      console.warn(`[stock-precheck] Failed for ${projectId}: ${err.message}`);
      // Never leave the user stuck on the gate. Must also set stockPrechecked=true,
      // otherwise frontend polling (stops on script_ready && stockPrechecked) loops forever.
      try {
        await updateProject(projectId, {
          script: { ...script, stockPrechecked: true },
          status: 'script_ready',
          progress: 20,
          progressMessage: 'Сценарий готов (стоки проверить не удалось — доступна AI-генерация).',
        });
      } catch {}
    });
  } catch (err: any) {
    console.error(`[video-gen] Script generation failed for ${projectId}:`, err.message);
    await updateProject(projectId, {
      status: 'error',
      error: err.message,
      progressMessage: `Ошибка генерации сценария: ${err.message}`,
    });
  }
}

async function runGenerationPipeline(projectId: string) {
  const update = (updates: Parameters<typeof updateProject>[1]) =>
    updateProject(projectId, updates);

  try {
    await ensureKeysLoaded();
    const project = await getProject(projectId);
    if (!project) throw new Error('Project not found');

    const useT2V = isT2VModel(project.animationModel);

    // ══════════════════════════════════════════════════════════════════════════
    // HEYGEN VIDEO-AGENT: single prompt → whole finished MP4 (bypasses scenes)
    // ══════════════════════════════════════════════════════════════════════════
    if (project.animationModel === 'heygen-agent') {
      const agentKey = process.env.FAL_AI_API_KEY;
      if (!agentKey) throw new Error('FAL_AI_API_KEY не настроен — нужен для HeyGen video-agent');
      const agentVideoPath = DATA_PATHS.videoFile(projectId);
      // Prefer the user's full brief (customScenario); otherwise build from topic + details.
      const agentPrompt = (project.customScenario && project.customScenario.trim())
        ? project.customScenario.trim()
        : [project.topic, project.additionalDetails].filter(Boolean).join('. ');
      await update({ status: 'animating', progress: 15, progressMessage: 'HeyGen video-agent: генерирую ролик по промпту...' });
      await generateAgentVideo({
        prompt: agentPrompt,
        outputPath: agentVideoPath,
        apiKey: agentKey,
        onWait: async (elapsedMs) => {
          await updateProject(projectId, { progress: Math.min(90, 15 + Math.round(elapsedMs / 1000)), progressMessage: `HeyGen video-agent: рендер ${Math.round(elapsedMs / 1000)}с...` });
        },
      });
      await update({
        status: 'done',
        progress: 100,
        progressMessage: 'Готово!',
        videoPath: agentVideoPath,
        videoUrl: `/video-app/api/videos/${projectId}/download`,
      });
      console.log(`[video-gen] HeyGen agent project ${projectId} done: ${agentVideoPath}`);
      return;
    }

    // ── Step 1: Generate script (skip if already approved) ───────────────────
    let script = project.script;
    if (!script) {
      await update({ status: 'generating_script', progress: 5, progressMessage: 'Генерирую сценарий...' });

      script = await generateScript({
        topic: project.topic,
        format: project.format,
        duration: project.duration,
        language: project.language,
        customScenario: project.customScenario,
        t2v: useT2V,
        animationModel: project.animationModel,
        clipDuration: project.clipDuration,
        scriptMode: project.scriptMode,
      });

      await update({
        script,
        progress: 20,
        progressMessage: `Сценарий готов: ${script.scenes.length} сцен`,
      });
    } else {
      console.log(`[video-gen] Using existing script for ${projectId} (${script.scenes.length} scenes)`);
      await update({ progress: 20, progressMessage: `Сценарий: ${script.scenes.length} сцен (из предпросмотра)` });
    }

    const imagesDir = DATA_PATHS.imagesDir(projectId);
    const audioDir = path.join(imagesDir, 'audio');
    const videoPath = DATA_PATHS.videoFile(projectId);
    const tempDir = path.join(imagesDir, '_temp');
    const clipsDir = path.join(imagesDir, 'clips');

    const falKey = process.env.FAL_AI_API_KEY;

    // ══════════════════════════════════════════════════════════════════════════
    // CHAIN PIPELINE: scene 0 = Kling T2V, scenes 1+ = Kling I2V (last frame)
    // ══════════════════════════════════════════════════════════════════════════
    if (project.animationModel === 'chain' && falKey) {
      const total = script.scenes.length;
      await update({ status: 'animating', progress: 22, progressMessage: `Chain: T2V сцена 1/${total}, затем I2V...` });

      await fs.mkdir(clipsDir, { recursive: true });
      await fs.mkdir(audioDir, { recursive: true });

      // Start TTS for all scenes in parallel immediately
      const ttsPromises = script.scenes.map(async (scene, i) => {
        const audioPath = path.join(audioDir, `scene_${i}.mp3`);
        try {
          return await generateAudio({ text: scene.narration || scene.text, language: project.language, outputPath: audioPath, targetDuration: project.clipDuration ?? scene.duration, voice: project.voice });
        } catch (err: any) {
          console.warn(`[tts] Chain scene ${i} failed: ${err.message}`);
          return null;
        }
      });

      // Sequential chain: T2V for scene 0, I2V for scenes 1+
      const clips: Array<{ clipPath: string; duration: number }> = [];
      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const clipPath = path.join(clipsDir, `clip_${i}.mp4`);

        await updateProject(projectId, {
          progress: 22 + Math.round((i / total) * 50),
          progressMessage: `Chain: сцена ${i + 1}/${total} (${i === 0 ? 'T2V Kling' : 'I2V от последнего кадра'})...`,
        });

        if (i === 0) {
          const prompt = scene.t2vPrompt || scene.imagePrompt;
          console.log(`[video-gen] Chain scene 1/${total}: T2V Kling, prompt="${prompt.slice(0, 80)}..."`);
          await animateText({
            prompt,
            format: project.format,
            durationSeconds: scene.duration,
            outputPath: clipPath,
            model: 'kling-t2v',
            clipDuration: project.clipDuration,
            onWait: async (elapsedMs) => {
              await updateProject(projectId, {
                progressMessage: `Chain T2V: сцена 1/${total} ждём ${Math.round(elapsedMs / 1000)}с...`,
              });
            },
          });
        } else {
          // Extract last frame of previous clip
          const prevClip = clips[i - 1].clipPath;
          const framePath = path.join(clipsDir, `chain_frame_${i - 1}.jpg`);
          console.log(`[video-gen] Chain scene ${i + 1}/${total}: extracting last frame from clip_${i - 1}.mp4`);
          const frameBuffer = await extractLastFrame(prevClip, framePath);
          const prompt = scene.motionPrompt || scene.t2vPrompt || scene.imagePrompt;
          console.log(`[video-gen] Chain scene ${i + 1}/${total}: I2V Kling, prompt="${prompt.slice(0, 80)}..."`);
          await animateFrame({
            imageBuffer: frameBuffer,
            prompt,
            format: project.format,
            durationSeconds: scene.duration,
            outputPath: clipPath,
            model: 'kling',
            clipDuration: project.clipDuration,
            onWait: async (elapsedMs) => {
              await updateProject(projectId, {
                progressMessage: `Chain I2V: сцена ${i + 1}/${total} ждём ${Math.round(elapsedMs / 1000)}с...`,
              });
            },
          });
        }

        clips.push({ clipPath, duration: scene.duration });
        await updateProject(projectId, {
          progress: 22 + Math.round(((i + 1) / total) * 50),
          progressMessage: `Chain: ${i + 1}/${total} клипов готово`,
        });
      }

      // Wait for TTS to complete
      const audioResults = await Promise.all(ttsPromises);

      const clipsWithAudio = clips.map((clip, i) => ({
        ...clip,
        audioPath: audioResults[i]?.path,
        audioDuration: audioResults[i]?.duration,
        text: script.scenes[i]?.text,
        narration: script.scenes[i]?.narration || script.scenes[i]?.text,
        role: script.scenes[i]?.role,
      }));

      await update({ status: 'assembling', progress: 75, progressMessage: 'Chain: склеиваю клипы...' });
      const chainScenes = await maybeWithTitleCard(clipsWithAudio, project.format, tempDir);
      const chainActualDurations = await assembleFromClips({
        scenes: chainScenes,
        outputPath: videoPath,
        tempDir,
        format: project.format,
        crossfadeDuration: 0.5,
        flashCut: false,
        hookTextOverlay: true,
        onProgress: async (pct, msg) => {
          await updateProject(projectId, { progress: 75 + Math.round(pct * 0.20), progressMessage: msg });
        },
      });

      await update({ progress: 95, progressMessage: 'Chain: накладываю субтитры...' });
      const latestProject = await getProject(projectId);
      await burnSubtitlesSynced({
        videoPath,
        scenes: chainScenes,
        format: project.format,
        style: latestProject?.subtitleStyle ?? project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
        options: {
          font: latestProject?.subtitleFont ?? project.subtitleFont,
          sizeMultiplier: subtitleSizeMultiplier(latestProject?.subtitleSize ?? project.subtitleSize),
          color: latestProject?.subtitleColor ?? project.subtitleColor,
        },
        actualDurations: chainActualDurations,
        crossfadeSec: 0.5,
      });

      await update({ progress: 98, progressMessage: 'Добавляю фоновую музыку...' });
      await applyMusic(projectId, videoPath, project.topic, script.scenes, project.clipDuration, undefined, project.scriptMode, project.musicVolume);
      await waitForFile(videoPath);
      await update({
        status: 'done',
        progress: 100,
        progressMessage: 'Готово!',
        videoPath,
        videoUrl: `/video-app/api/videos/${projectId}/download`,
      });

      console.log(`[video-gen] Chain project ${projectId} done: ${videoPath}`);
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // T2V PIPELINE: text → FAL T2V → clips → assemble (no image generation)
    // ══════════════════════════════════════════════════════════════════════════
    if (useT2V && falKey) {
      await update({ status: 'animating', progress: 22, progressMessage: `T2V: генерирую ${script.scenes.length} клипов параллельно...` });

      await fs.mkdir(clipsDir, { recursive: true });
      await fs.mkdir(audioDir, { recursive: true });

      const total = script.scenes.length;
      let completedClips = 0;

      // Per-scene TTS promises kept as an array so an 'avatar' scene can await its
      // own audio (HeyGen lip-syncs to it) even within the T2V pipeline.
      const t2vTtsArr = script.scenes.map(async (scene, i) => {
        const audioPath = path.join(audioDir, `scene_${i}.mp3`);
        try {
          return await generateAudio({ text: scene.narration || scene.text, language: project.language, outputPath: audioPath, targetDuration: project.clipDuration ?? scene.duration, voice: project.voice });
        } catch (err: any) {
          console.warn(`[tts] Scene ${i} failed: ${err.message}`);
          return null;
        }
      });

      const [clips, audioResults] = await Promise.all([
        // Phase A: T2V clips in parallel
        Promise.all(
          script.scenes.map(async (scene, i) => {
            const clipPath = path.join(clipsDir, `clip_${i}.mp4`);
            if (scene.videoSource === 'stock') {
              const query = scene.stockQuery || scene.imagePrompt || scene.text;
              console.log(`[video-gen] T2V scene ${i + 1}: STOCK "${query.slice(0, 60)}"`);
              await updateProject(projectId, { progressMessage: `Stock: поиск клипа для сцены ${i + 1}/${total}...` });
              await searchAndDownloadStockClip({ query, outputPath: clipPath, durationSeconds: project.clipDuration ?? scene.duration, format: project.format });
            } else if (scene.videoSource === 'avatar') {
              // HeyGen digital-twin lip-synced to this scene's TTS (clip audio is
              // discarded at assembly; the TTS file is muxed instead → perfect sync).
              let audioBuffer: Buffer | null = null;
              try {
                await t2vTtsArr[i];
                audioBuffer = await fs.readFile(path.join(audioDir, `scene_${i}.mp3`));
              } catch (e: any) {
                console.warn(`[video-gen] T2V scene ${i + 1}: avatar TTS unavailable (${e?.message}) — using prompt fallback`);
              }
              try {
                await generateAvatarClip({
                  avatarName: project.heygenAvatar || DEFAULT_HEYGEN_AVATAR,
                  audioBuffer,
                  prompt: audioBuffer ? undefined : (scene.narration || scene.text),
                  format: project.format,
                  outputPath: clipPath,
                  apiKey: falKey!,
                  onWait: async (elapsedMs) => {
                    await updateProject(projectId, { progressMessage: `Аватар: ${completedClips}/${total} готово, сцена ${i + 1} (${Math.round(elapsedMs / 1000)}с)...` });
                  },
                });
              } catch (avErr: any) {
                console.warn(`[video-gen] T2V scene ${i + 1}: avatar failed (${avErr.message}) — using title card fallback`);
                await makeTitleCardClip({ text: scene.text, durationSeconds: project.clipDuration ?? scene.duration, outputPath: clipPath, format: project.format });
              }
            } else {
              const prompt = scene.t2vPrompt || scene.imagePrompt;
              console.log(`[video-gen] T2V scene ${i + 1}: prompt="${prompt.slice(0, 80)}..."`);
              await animateText({
                prompt,
                format: project.format,
                durationSeconds: scene.duration,
                outputPath: clipPath,
                model: project.animationModel,
                clipDuration: project.clipDuration,
                onWait: async (elapsedMs) => {
                  await updateProject(projectId, {
                    progressMessage: `T2V: ${completedClips}/${total} готово, сцена ${i + 1} (${Math.round(elapsedMs / 1000)}с)...`,
                  });
                },
              });
            }
            completedClips++;
            await updateProject(projectId, {
              progress: 22 + Math.round((completedClips / total) * 50),
              progressMessage: `T2V: ${completedClips}/${total} клипов готово`,
            });
            return { clipPath, duration: scene.duration };
          })
        ),
        // Phase B: TTS (same per-scene promises) resolved in parallel with video generation
        Promise.all(t2vTtsArr),
      ]);

      const clipsWithAudio = clips.map((clip, i) => ({
        ...clip,
        audioPath: audioResults[i]?.path,
        audioDuration: audioResults[i]?.duration,
        text: script.scenes[i]?.text,
        narration: script.scenes[i]?.narration || script.scenes[i]?.text,
        role: script.scenes[i]?.role,
      }));

      await update({ status: 'assembling', progress: 75, progressMessage: 'Склеиваю клипы...' });

      const t2vScenes = await maybeWithTitleCard(clipsWithAudio, project.format, tempDir);
      const i2vActualDurations = await assembleFromClips({
        scenes: t2vScenes,
        outputPath: videoPath,
        tempDir,
        format: project.format,
        crossfadeDuration: 0.5,
        flashCut: false,
        hookTextOverlay: true,
        onProgress: async (pct, msg) => {
          await updateProject(projectId, { progress: 75 + Math.round(pct * 0.20), progressMessage: msg });
        },
      });

      await update({ progress: 95, progressMessage: 'Накладываю субтитры...' });
      await burnSubtitlesSynced({
        videoPath,
        scenes: t2vScenes,
        format: project.format,
        style: project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
        options: {
          font: project.subtitleFont,
          sizeMultiplier: subtitleSizeMultiplier(project.subtitleSize),
          color: project.subtitleColor,
        },
        actualDurations: i2vActualDurations,
        crossfadeSec: 0.5,
      });

      await update({ progress: 98, progressMessage: 'Добавляю фоновую музыку...' });
      await applyMusic(projectId, videoPath, project.topic, script.scenes, project.clipDuration, project.musicStyle, project.scriptMode, project.musicVolume);
      await waitForFile(videoPath);
      await update({
        status: 'done',
        progress: 100,
        progressMessage: 'Готово!',
        videoPath,
        videoUrl: `/video-app/api/videos/${projectId}/download`,
      });

      console.log(`[video-gen] T2V project ${projectId} done: ${videoPath}`);
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // I2V PIPELINE: image generation → FAL I2V → clips → assemble
    // ══════════════════════════════════════════════════════════════════════════
    let chainSucceeded = false;

    if (falKey) {
      try {
        const framesDir = path.join(imagesDir, 'frames');
        await fs.mkdir(framesDir, { recursive: true });
        await fs.mkdir(clipsDir, { recursive: true });

        const total = script.scenes.length;

        // ── Phase 0: pre-check stock scenes — download clips, switch failures to AI ──
        const stockScenesExist = script.scenes.some(s => s.videoSource === 'stock');
        if (stockScenesExist) {
          await update({ status: 'generating_images', progress: 10, progressMessage: `Проверяю stock-клипы...` });
          await Promise.all(
            script.scenes.map(async (scene, i) => {
              if (scene.videoSource !== 'stock') return;
              const query = scene.stockQuery || scene.imagePrompt || scene.text;
              const clipPath = path.join(clipsDir, `clip_${i}.mp4`);
              try {
                await searchAndDownloadStockClip({ query, outputPath: clipPath, durationSeconds: project.clipDuration ?? scene.duration, format: project.format });
                console.log(`[video-gen] Phase0: stock clip_${i} ready`);
              } catch (stockErr: any) {
                console.warn(`[video-gen] Phase0: stock scene ${i + 1} not found — switching to AI`);
                // Persist videoSource='ai' to DB
                const fresh = await getProject(projectId);
                if (fresh?.script) {
                  const updatedScenes = fresh.script.scenes.map((s, si) =>
                    si === i ? { ...s, videoSource: 'ai' as const } : s
                  );
                  await updateProject(projectId, { script: { ...fresh.script, scenes: updatedScenes } });
                  script.scenes[i] = { ...script.scenes[i], videoSource: 'ai' };
                }
              }
            })
          );

          // Reload script after Phase 0 (videoSource may have changed)
          const refreshed = await getProject(projectId);
          if (refreshed?.script) {
            script.scenes = refreshed.script.scenes as typeof script.scenes;
          }

          // Pause if any stock scenes were switched to AI and have no selected variant
          const stockFailedScenes = script.scenes
            .map((s, i) => ({ s, i }))
            .filter(({ s, i }) => {
              const wasStock = project.script?.scenes[i]?.videoSource === 'stock';
              return wasStock && s.videoSource !== 'stock';
            });

          if (stockFailedScenes.length > 0) {
            const needVariants = stockFailedScenes.filter(
              ({ s }) => typeof (s as any).selectedVariant !== 'number'
            );
            if (needVariants.length > 0) {
              const sceneNums = needVariants.map(({ i }) => i + 1).join(', ');
              await update({
                status: 'script_ready',
                progress: 0,
                progressMessage: `Сцены ${sceneNums} не найдены в Pexels — сгенерируйте изображения и выберите лучшее, затем нажмите «Генерировать видео»`,
              });
              console.log(`[video-gen] Phase0: paused — scenes ${sceneNums} need image variants`);
              chainSucceeded = true; // prevent static fallback from running
              return; // exit pipeline, user will restart after picking images
            }
          }
        }

        // Phase A: generate all frames in parallel
        await update({ status: 'generating_images', progress: 22, progressMessage: `Генерирую ${total} кадров параллельно...` });

        const frameBuffers = await Promise.all(
          script.scenes.map(async (scene, i) => {
            if (scene.videoSource === 'stock' || scene.videoSource === 'avatar') return null; // skip image gen for stock/avatar scenes

            const framePath = path.join(framesDir, `frame_${i}.jpg`);

            // Use selected image variant if available
            if (typeof (scene as any).selectedVariant === 'number') {
              const variantPath = path.join(DATA_PATHS.imagesDir(projectId), 'variants', `scene_${i}_v${(scene as any).selectedVariant}.jpg`);
              try {
                await fs.access(variantPath);
                await fs.copyFile(variantPath, framePath);
                console.log(`[video-gen] Scene ${i}: using selected variant ${(scene as any).selectedVariant}`);
                return fs.readFile(framePath);
              } catch {
                console.warn(`[video-gen] Scene ${i}: variant file not found, generating fresh`);
              }
            }

            if (scene.backgroundPrompt && scene.subjectPrompt) {
              await generateLayeredImage({
                backgroundPrompt: scene.backgroundPrompt,
                subjectPrompt: scene.subjectPrompt,
                format: project.format,
                outputPath: framePath,
                sceneText: scene.text,
              });
            } else {
              await generateImage({
                prompt: scene.imagePrompt,
                format: project.format,
                outputPath: framePath,
                sceneText: scene.text,
              });
            }
            return fs.readFile(framePath);
          })
        );

        await update({ progress: 35, progressMessage: `Анимирую ${total} сцен параллельно...` });

        // Phase B: animate all frames + TTS in parallel
        let completedClips = 0;
        // Animation runs ~60-90s with all scenes in parallel, so completedClips stays 0
        // for most of it. Drive a smooth time-based estimate so the bar advances during
        // animation instead of freezing at 35% then jumping. Band: 35→73 over ~90s.
        const animStart = Date.now();
        const ANIM_EXPECTED_MS = 90000;
        // Per-scene TTS promises kept as an array so avatar clips can await their own
        // scene's audio (HeyGen lip-syncs to it) while other scenes animate in parallel.
        const ttsArr = script.scenes.map(async (scene, i) => {
          const audioPath = path.join(audioDir, `scene_${i}.mp3`);
          try {
            return await generateAudio({ text: scene.narration || scene.text, language: project.language, outputPath: audioPath, targetDuration: project.clipDuration ?? scene.duration, voice: project.voice });
          } catch (err: any) {
            console.warn(`[tts] Scene ${i} failed: ${err.message}`);
            return null;
          }
        });
        const ttsPromises = Promise.all(ttsArr);
        // Cap TTS wait to 2 minutes — if slower, proceed with silence for failed scenes
        const ttsWithCap = Promise.race([
          ttsPromises,
          new Promise<null[]>(resolve => setTimeout(() => {
            console.warn(`[tts] Overall timeout reached — proceeding with available audio`);
            resolve(new Array(script.scenes.length).fill(null));
          }, 120000)),
        ]);

        const clips = await Promise.all(
          script.scenes.map(async (scene, i) => {
            const clipPath = path.join(clipsDir, `clip_${i}.mp4`);
            if (scene.videoSource === 'stock') {
              // Phase 0 already downloaded this clip — just log and continue
              let clipReady = false;
              try { await fs.access(clipPath); clipReady = true; } catch {}
              if (clipReady) {
                console.log(`[video-gen] I2V scene ${i + 1}: STOCK clip already ready (Phase 0)`);
              } else {
                // Safety net: Phase 0 didn't run or clip was deleted — try again
                const query = scene.stockQuery || scene.imagePrompt || scene.text;
                console.log(`[video-gen] I2V scene ${i + 1}: STOCK re-downloading "${query.slice(0, 60)}"`);
                await searchAndDownloadStockClip({ query, outputPath: clipPath, durationSeconds: project.clipDuration ?? scene.duration, format: project.format });
              }
            } else if (scene.videoSource === 'avatar') {
              // HeyGen digital-twin: talking avatar lip-synced to THIS scene's TTS.
              // Wait for the scene's own audio, then feed it as audio_url. The clip's
              // built-in audio is discarded at assembly (-map 1:a:0 uses the TTS file),
              // so the lip-sync stays perfectly aligned with no double audio.
              let audioBuffer: Buffer | null = null;
              try {
                await ttsArr[i];
                const audioPath = path.join(audioDir, `scene_${i}.mp3`);
                audioBuffer = await fs.readFile(audioPath);
              } catch (e: any) {
                console.warn(`[video-gen] I2V scene ${i + 1}: avatar TTS unavailable (${e?.message}) — using prompt fallback`);
              }
              try {
                await generateAvatarClip({
                  avatarName: project.heygenAvatar || DEFAULT_HEYGEN_AVATAR,
                  audioBuffer,
                  prompt: audioBuffer ? undefined : (scene.narration || scene.text),
                  format: project.format,
                  outputPath: clipPath,
                  apiKey: falKey!,
                  onWait: async (elapsedMs) => {
                    const timePct = 35 + Math.round(Math.min((Date.now() - animStart) / ANIM_EXPECTED_MS, 0.95) * 38);
                    const stepFloor = 35 + Math.round((completedClips / total) * 40);
                    await updateProject(projectId, {
                      progress: Math.max(timePct, stepFloor),
                      progressMessage: `Аватар: ${completedClips}/${total} готово, сцена ${i + 1} (${Math.round(elapsedMs / 1000)}с)...`,
                    });
                  },
                });
              } catch (avErr: any) {
                console.warn(`[video-gen] Scene ${i + 1}: avatar generation failed (${avErr.message}) — using static frame fallback`);
                await updateProject(projectId, { progressMessage: `⚠️ Сцена ${i + 1}: аватар недоступен — использую статичный кадр` });
                const framePath = path.join(framesDir, `frame_${i}.jpg`);
                const clipDur = project.clipDuration ?? scene.duration;
                try {
                  await makeStaticClipFromImage({ imagePath: framePath, durationSeconds: clipDur, outputPath: clipPath, format: project.format, sceneIndex: i });
                } catch {
                  await makeTitleCardClip({ text: scene.text, durationSeconds: clipDur, outputPath: clipPath, format: project.format });
                }
              }
            } else {
              try {
                await animateFrame({
                  imageBuffer: frameBuffers[i]!,
                  prompt: scene.motionPrompt || scene.imagePrompt,
                  format: project.format,
                  durationSeconds: scene.duration,
                  outputPath: clipPath,
                  model: project.animationModel,
                  clipDuration: project.clipDuration,
                  onWait: async (elapsedMs) => {
                    // Monotonic: never report below the step floor already reached by
                    // completed clips, even if other scenes finish faster than expected.
                    const timePct = 35 + Math.round(Math.min((Date.now() - animStart) / ANIM_EXPECTED_MS, 0.95) * 38);
                    const stepFloor = 35 + Math.round((completedClips / total) * 40);
                    await updateProject(projectId, {
                      progress: Math.max(timePct, stepFloor),
                      progressMessage: `Анимация: ${completedClips}/${total} готово, сцена ${i + 1} (${Math.round(elapsedMs / 1000)}с)...`,
                    });
                  },
                  onFallback: async (fromModel, toModel, reason) => {
                    console.warn(`[video-gen] Scene ${i + 1}: ${fromModel} failed (${reason.slice(0, 120)}), switching to ${toModel}`);
                    await updateProject(projectId, {
                      progressMessage: `⚠️ Сцена ${i + 1}: ${fromModel} недоступен → переключаюсь на ${toModel}...`,
                    });
                  },
                });
              } catch (animErr: any) {
                // All FAL models failed for this scene — fall back to a static image clip
                // so that the rest of the video is still assembled correctly.
                console.warn(`[video-gen] Scene ${i + 1}: all animation models failed (${animErr.message}) — using static frame fallback`);
                await updateProject(projectId, {
                  progressMessage: `⚠️ Сцена ${i + 1}: анимация недоступна — использую статичный кадр`,
                });
                const framePath = path.join(framesDir, `frame_${i}.jpg`);
                const clipDur = project.clipDuration ?? scene.duration;
                await makeStaticClipFromImage({ imagePath: framePath, durationSeconds: clipDur, outputPath: clipPath, format: project.format, sceneIndex: i });
              }
            }
            completedClips++;
            const stepPct = 35 + Math.round((completedClips / total) * 40);
            const timePct = 35 + Math.round(Math.min((Date.now() - animStart) / ANIM_EXPECTED_MS, 0.95) * 38);
            await updateProject(projectId, {
              progress: Math.max(stepPct, timePct),
              progressMessage: `Анимация: ${completedClips}/${total} сцен готово`,
            });
            return { clipPath, duration: scene.duration };
          })
        );
        const audioResults = await ttsWithCap;

        const clipsWithAudio = clips.map((clip, i) => ({
          ...clip,
          audioPath: audioResults[i]?.path,
          audioDuration: audioResults[i]?.duration,
          text: script.scenes[i]?.text,
          narration: script.scenes[i]?.narration || script.scenes[i]?.text,
          role: script.scenes[i]?.role,
        }));

        await update({ status: 'assembling', progress: 78, progressMessage: 'Склеиваю клипы...' });

        const i2vScenes = await maybeWithTitleCard(clipsWithAudio, project.format, tempDir);
        const parallelActualDurations = await assembleFromClips({
          scenes: i2vScenes,
          outputPath: videoPath,
          tempDir,
          format: project.format,
          crossfadeDuration: 0.5,
          flashCut: false,
          hookTextOverlay: true,
          onProgress: async (pct, msg) => {
            await updateProject(projectId, { progress: 78 + Math.round(pct * 0.18), progressMessage: msg });
          },
        });

        await update({ progress: 96, progressMessage: 'Накладываю субтитры...' });
        await burnSubtitlesSynced({
          videoPath,
          scenes: i2vScenes,
          format: project.format,
          style: project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
          options: {
            font: project.subtitleFont,
            sizeMultiplier: subtitleSizeMultiplier(project.subtitleSize),
            color: project.subtitleColor,
          },
          actualDurations: parallelActualDurations,
          crossfadeSec: 0.5,
        });

        chainSucceeded = true;
        console.log(`[video-gen] I2V parallel pipeline complete for ${projectId}`);
      } catch (chainErr: any) {
        console.warn(`[video-gen] I2V animation failed: ${chainErr.message} — falling back to static image pipeline`);
        await update({ progress: 22, progressMessage: 'Переключаюсь на статичные изображения...' });
      }
    }

    // ── Fallback: static image pipeline (no FAL) ──────────────────────────────
    if (!chainSucceeded) {
      await update({ status: 'generating_images', progress: 25, progressMessage: 'Генерирую изображения (Imagen 4)...' });

      const updatedScenes = [...script.scenes];

      for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const imagePath = path.join(imagesDir, `scene_${i}.jpg`);
        const pct = 25 + Math.round(((i + 1) / script.scenes.length) * 45);

        await updateProject(projectId, {
          progress: pct,
          progressMessage: `Изображение ${i + 1}/${script.scenes.length}...`,
        });

        if (scene.backgroundPrompt && scene.subjectPrompt) {
          await generateLayeredImage({
            backgroundPrompt: scene.backgroundPrompt,
            subjectPrompt: scene.subjectPrompt,
            format: project.format,
            outputPath: imagePath,
            sceneText: scene.text,
          });
        } else {
          await generateImage({
            prompt: scene.imagePrompt,
            format: project.format,
            outputPath: imagePath,
            sceneText: scene.text,
          });
        }

        updatedScenes[i] = { ...scene, imagePath };
      }

      const updatedScript = { ...script, scenes: updatedScenes };
      await update({ script: updatedScript, progress: 70, progressMessage: 'Генерирую озвучку...' });

      type SceneWithAudio = typeof updatedScenes[0] & { audioPath?: string; audioDuration?: number };
      const scenesWithAudio = await Promise.all(
        updatedScenes.map(async (scene, i): Promise<SceneWithAudio> => {
          const audioPath = path.join(audioDir, `scene_${i}.mp3`);
          try {
            const audio = await generateAudio({ text: scene.narration || scene.text, language: project.language, outputPath: audioPath, targetDuration: project.clipDuration ?? scene.duration, voice: project.voice });
            return { ...scene, audioPath: audio?.path, audioDuration: audio?.duration };
          } catch (err: any) {
            console.warn(`[tts] Scene ${i} failed: ${err.message}`);
            return scene;
          }
        })
      );

      await update({ status: 'assembling', progress: 78, progressMessage: 'Рендеринг...' });

      const assemblerScenes = scenesWithAudio.map((s) => ({
        imagePath: s.imagePath!,
        text: s.text,
        narration: s.narration || s.text,
        duration: s.duration,
        audioPath: s.audioPath,
        audioDuration: s.audioDuration,
      }));

      await assembleVideo({
        scenes: assemblerScenes,
        format: project.format,
        outputPath: videoPath,
        tempDir,
        onProgress: async (pct, msg) => {
          await updateProject(projectId, { progress: 78 + Math.round(pct * 0.18), progressMessage: msg });
        },
      });

      await update({ progress: 96, progressMessage: 'Накладываю субтитры...' });
      await burnSubtitlesSynced({
        videoPath,
        scenes: assemblerScenes,
        format: project.format,
        style: project.subtitleStyle ?? (project.format === '9:16' ? 'tiktok' : 'karaoke'),
        options: {
          font: project.subtitleFont,
          sizeMultiplier: subtitleSizeMultiplier(project.subtitleSize),
          color: project.subtitleColor,
        },
      });
    }

    // ── Done ─────────────────────────────────────────────────────────────────
    await update({ progress: 98, progressMessage: 'Добавляю фоновую музыку...' });
    await applyMusic(projectId, videoPath, project.topic, script.scenes, project.clipDuration, project.musicStyle, project.scriptMode, project.musicVolume);
    await waitForFile(videoPath);
    await update({
      status: 'done',
      progress: 100,
      progressMessage: 'Готово!',
      videoPath,
      videoUrl: `/video-app/api/videos/${projectId}/download`,
    });

    console.log(`[video-gen] Project ${projectId} done: ${videoPath}`);
  } catch (err: any) {
    console.error(`[video-gen] Pipeline failed for ${projectId}:`, err.message);
    await updateProject(projectId, {
      status: 'error',
      error: err.message,
      progressMessage: `Ошибка: ${err.message}`,
    });
  }
}

export default router;
