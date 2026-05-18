import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import type { VideoFormat, SubtitleStyle } from '../db.js';

// Prefer system ffmpeg (works on Alpine/musl in Docker); fall back to installer binary (Replit/glibc)
function resolveFfmpegPath(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return ffmpegInstaller.path;
}
const FFMPEG_BIN = resolveFfmpegPath();
ffmpeg.setFfmpegPath(FFMPEG_BIN);
const execFileAsync = promisify(execFile);

export interface SubtitleOptions {
  font?: string;
  sizeMultiplier?: number;
  color?: string;
}

function hexToAssColor(hex: string): string {
  const h = (hex ?? '#ffffff').replace('#', '').padEnd(6, 'f');
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

const SUBTITLE_SIZE_MAP: Record<string, number> = {
  small: 0.75, medium: 1.0, large: 1.3, xlarge: 1.6,
};
export function subtitleSizeMultiplier(size?: string): number {
  return SUBTITLE_SIZE_MAP[size ?? 'medium'] ?? 1.0;
}

const FORMAT_SIZES: Record<VideoFormat, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
};

export interface AssemblerScene {
  imagePath: string;
  text: string;
  narration?: string;
  duration: number;
  audioPath?: string;    // optional TTS audio
  audioDuration?: number; // actual audio duration (may differ from scene.duration)
}

function escapeText(t: string): string {
  return t
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

async function makeClip(
  scene: AssemblerScene,
  format: VideoFormat,
  outputPath: string
): Promise<void> {
  const { w, h } = FORMAT_SIZES[format];
  const fps = 25;
  const fontSize = Math.max(28, Math.round(w * 0.038));
  const boxPad = Math.round(fontSize * 0.5);
  const yPos = `h-${Math.round(h * 0.08)}-text_h`;
  const safeText = escapeText(scene.text);

  // Clip duration: prefer audio duration (with small padding), min = scene.duration
  const clipDuration = scene.audioDuration
    ? Math.max(scene.duration, scene.audioDuration + 0.3)
    : scene.duration;

  const fontFilter = safeText
    ? `drawtext=text='${safeText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${yPos}:box=1:boxcolor=black@0.65:boxborderw=${boxPad}`
    : 'null';

  const videoFilter = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    fontFilter,
  ]
    .filter((f) => f !== 'null')
    .join(',');

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg();

    // Video: looped image
    cmd
      .input(scene.imagePath)
      .inputOptions(['-loop 1', `-t ${clipDuration}`]);

    // Audio: TTS file or silent audio track
    if (scene.audioPath) {
      cmd.input(scene.audioPath);
    }

    cmd.videoFilter(videoFilter);

    const outOpts = [
      `-t ${clipDuration}`,
      '-c:v libx264',
      '-preset ultrafast',
      '-crf 26',
      '-pix_fmt yuv420p',
      `-r ${fps}`,
    ];

    if (scene.audioPath) {
      // Mix audio into video, pad silence if video longer than audio
      outOpts.push(
        '-c:a aac',
        '-b:a 128k',
        '-af apad',          // pad audio with silence to match video length
        '-shortest',         // but don't exceed video length
      );
    } else {
      // Add silent audio track so all clips have audio streams for concat
      outOpts.push(
        '-f lavfi',
        // silent audio is added via input, not here — handled below
      );
    }

    cmd
      .outputOptions(outOpts)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg clip error: ${err.message}`)))
      .run();
  });
}

async function makeClipWithSilence(
  scene: AssemblerScene,
  format: VideoFormat,
  outputPath: string
): Promise<void> {
  // For clips without audio: generate video + silent audio track so all clips are compatible
  const { w, h } = FORMAT_SIZES[format];
  const fps = 25;
  const fontSize = Math.max(28, Math.round(w * 0.038));
  const boxPad = Math.round(fontSize * 0.5);
  const yPos = `h-${Math.round(h * 0.08)}-text_h`;
  const safeText = escapeText(scene.text);
  const clipDuration = scene.duration;

  const fontFilter = safeText
    ? `drawtext=text='${safeText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${yPos}:box=1:boxcolor=black@0.65:boxborderw=${boxPad}`
    : 'null';

  const videoFilter = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    fontFilter,
  ]
    .filter((f) => f !== 'null')
    .join(',');

  const ffmpegPath = FFMPEG_BIN;

  // Build command manually for lavfi silent audio + image
  const args = [
    '-loop', '1', '-t', String(clipDuration), '-i', scene.imagePath,
    '-f', 'lavfi', '-t', String(clipDuration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', videoFilter,
    '-t', String(clipDuration),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '128k',
    '-y', outputPath,
  ];

  await execFileAsync(ffmpegPath, args);
}

// ── Extract last frame from video clip ───────────────────────────────────────

export async function extractLastFrame(videoPath: string, outputPath: string): Promise<Buffer> {
  const ffmpegPath = FFMPEG_BIN;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Grab the very last frame (-sseof -0.1 seeks 0.1s before EOF)
  const args = [
    '-sseof', '-0.1',
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-y', outputPath,
  ];

  await execFileAsync(ffmpegPath, args);
  return fs.readFile(outputPath);
}

// ── Veo clip assembly (video clips + TTS audio → final mp4) ──────────────────

export interface VeoScene {
  clipPath: string;
  duration: number;
  audioPath?: string;
  audioDuration?: number;
  narration?: string;
}

// ── Karaoke subtitle generation ───────────────────────────────────────────────

interface KaraokeSceneEntry {
  narration: string;
  text: string;       // short subtitle (max 8 words) — used by cinematic style
  startTime: number;
  duration: number;
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const frac = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

function generateKaraokeASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.040) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.07);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // PrimaryColour=user color, SecondaryColour=yellow (highlighted word), Outline=black, Back=semi-transparent dark
    `Style: Karaoke,${font},${fontSize},${primaryColor},&H0000FFFF,&H00000000,&HA0000000,1,0,0,0,100,100,1,0,1,3,1,2,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const dialogues = scenes
    .filter(s => s.narration.trim())
    .map(scene => {
      const words = scene.narration.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return '';
      const totalCs = Math.round(scene.duration * 100);
      const csPerWord = Math.round(totalCs / words.length);
      // \kf = karaoke fill: smooth highlight sweep across each word
      const karaokeText = words.map(w => `{\\kf${csPerWord}}${w}`).join(' ');
      return `Dialogue: 0,${formatAssTime(scene.startTime)},${formatAssTime(scene.startTime + scene.duration)},Karaoke,,0,0,0,,${karaokeText}`;
    })
    .filter(Boolean)
    .join('\n');

  return header + '\n' + dialogues + '\n';
}

// ── ASS generators for each subtitle style ────────────────────────────────────

function makeAssHeader(w: number, h: number, styleLine: string): string {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

/** Style: plain — sentence appears instantly, no animation */
function generatePlainASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.038) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.07);
  const styleLine = `Style: Plain,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&HA0000000,1,0,0,0,100,100,1,0,1,3,1,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const dialogues = scenes
    .filter(s => s.narration.trim())
    .map(s => `Dialogue: 0,${formatAssTime(s.startTime)},${formatAssTime(s.startTime + s.duration)},Plain,,0,0,0,,${s.narration.trim()}`)
    .join('\n');

  return header + '\n' + dialogues + '\n';
}

/** Style: fade-in/out — full sentence appears with smooth fade */
function generateFadeASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.038) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.07);
  const styleLine = `Style: Fade,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&HA0000000,1,0,0,0,100,100,1,0,1,3,1,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const fadeMs = 350;
  const dialogues = scenes
    .filter(s => s.narration.trim())
    .map(s => {
      const text = `{\\fad(${fadeMs},${fadeMs})}${s.narration.trim()}`;
      return `Dialogue: 0,${formatAssTime(s.startTime)},${formatAssTime(s.startTime + s.duration)},Fade,,0,0,0,,${text}`;
    }).join('\n');

  return header + '\n' + dialogues + '\n';
}

/** Style: TikTok — one word at a time, large bold font */
function generateTiktokASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.070) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.10);
  // BorderStyle=1 (outline only, no background box), bold, large
  const styleLine = `Style: TikTok,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const lines: string[] = [];
  for (const s of scenes) {
    const words = s.narration.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const wordDur = s.duration / words.length;
    words.forEach((word, i) => {
      const start = s.startTime + i * wordDur;
      const end = start + wordDur;
      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},TikTok,,0,0,0,,{\\fad(80,80)}${word}`);
    });
  }

  return header + '\n' + lines.join('\n') + '\n';
}

/** Style: word-by-word accumulate — words appear one-by-one, stay on screen */
function generateWordByWordASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.038) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.07);
  const styleLine = `Style: WordByWord,${font},${fontSize},${primaryColor},&H0000FFFF,&H00000000,&HA0000000,1,0,0,0,100,100,1,0,1,3,1,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const lines: string[] = [];
  for (const s of scenes) {
    const words = s.narration.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const wordDur = s.duration / words.length;
    words.forEach((word, i) => {
      const start = s.startTime + i * wordDur;
      // Each line ends exactly when the next word starts — no overlap between dialogue lines
      const end = i < words.length - 1 ? s.startTime + (i + 1) * wordDur : s.startTime + s.duration;
      // Previous words in white, new word in yellow
      const prev = words.slice(0, i).join(' ');
      const curr = `{\\c&H0000FFFF&}${word}{\\c&H00FFFFFF&}`;
      const text = prev ? `${prev} ${curr}` : curr;
      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},WordByWord,,0,0,0,,${text}`);
    });
  }

  return header + '\n' + lines.join('\n') + '\n';
}

/** Style: cinematic — large uppercase text, center-screen, blur-reveal + scale animation — real movie trailer look */
function generateCinematicASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.068) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const spacing = Math.round(w * 0.020);
  const styleLine = `Style: Cinematic,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&HAA000000,1,0,0,0,100,100,${spacing},0,1,1,5,5,60,60,0,1`;
  const header = makeAssHeader(w, h, styleLine);

  const dialogues = scenes
    .filter(s => (s.text || s.narration).trim())
    .map(s => {
      const raw = (s.text || s.narration).trim().toUpperCase();
      // Split into 2 lines at middle word boundary if long
      let displayText = raw;
      if (raw.length > 18) {
        const words = raw.split(' ');
        const mid = Math.ceil(words.length / 2);
        displayText = words.slice(0, mid).join(' ') + '\\N' + words.slice(mid).join(' ');
      }
      // Appear 0.4s into scene, disappear 0.6s before end
      const holdStart = s.startTime + 0.4;
      const holdEnd = s.startTime + s.duration - 0.6;
      if (holdEnd <= holdStart + 0.5) return '';
      // Cinematic reveal:
      //   \blur15 → starts blurry (mist/fog effect)
      //   \fscx92\fscy92 → starts slightly smaller
      //   \t(0,1000,...) → over 1 second: blur clears, scales to 100%
      //   \fad(0,700) → fades out over last 700ms (no fade-in — the blur handles the reveal)
      const text = `{\\blur15\\fscx92\\fscy92\\t(0,1000,1,\\blur0\\fscx100\\fscy100)\\fad(0,700)}${displayText}`;
      return `Dialogue: 0,${formatAssTime(holdStart)},${formatAssTime(holdEnd)},Cinematic,,0,0,0,,${text}`;
    })
    .filter(Boolean)
    .join('\n');

  return header + '\n' + dialogues + '\n';
}

/** Style: cinematic-full — full narration text with same blur-reveal animation, bottom-center position */
function generateCinematicFullASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.042) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const spacing = Math.round(w * 0.008);
  const marginV = Math.round(h * 0.06);
  const styleLine = `Style: CinematicFull,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&HAA000000,0,0,0,0,100,100,${spacing},0,1,2,4,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const dialogues = scenes
    .filter(s => (s.narration || s.text).trim())
    .map(s => {
      const text = (s.narration || s.text).trim();
      const holdStart = s.startTime + 0.3;
      const holdEnd = s.startTime + s.duration - 0.4;
      if (holdEnd <= holdStart + 0.3) return '';
      // Same blur-reveal but softer: starts blurry, clears over 700ms; fades out 500ms
      const assText = `{\\blur10\\t(0,700,1,\\blur0)\\fad(0,500)}${text}`;
      return `Dialogue: 0,${formatAssTime(holdStart)},${formatAssTime(holdEnd)},CinematicFull,,0,0,0,,${assText}`;
    })
    .filter(Boolean)
    .join('\n');

  return header + '\n' + dialogues + '\n';
}

/** Style: bar — white text on semi-transparent dark background strip */
function generateBarASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = Math.round(Math.round(w * 0.036) * (options.sizeMultiplier ?? 1));
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.06);
  // BorderStyle=3: opaque box; BackColour = 75% opaque black (&HC0000000)
  const styleLine = `Style: Bar,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&HC0000000,1,0,0,0,100,100,1,0,3,0,0,2,20,20,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const dialogues = scenes
    .filter(s => s.narration.trim())
    .map(s => `Dialogue: 0,${formatAssTime(s.startTime)},${formatAssTime(s.startTime + s.duration)},Bar,,0,0,0,,${s.narration.trim()}`)
    .join('\n');

  return header + '\n' + dialogues + '\n';
}

function generateSubtitleASS(scenes: KaraokeSceneEntry[], format: VideoFormat, style: SubtitleStyle, options: SubtitleOptions = {}): string {
  switch (style) {
    case 'plain':       return generatePlainASS(scenes, format, options);
    case 'fade':        return generateFadeASS(scenes, format, options);
    case 'tiktok':      return generateTiktokASS(scenes, format, options);
    case 'word-by-word': return generateWordByWordASS(scenes, format, options);
    case 'cinematic':      return generateCinematicASS(scenes, format, options);
    case 'cinematic-full': return generateCinematicFullASS(scenes, format, options);
    case 'bar':            return generateBarASS(scenes, format, options);
    case 'karaoke':
    default:            return generateKaraokeASS(scenes, format, options);
  }
}

/**
 * Burns subtitles into an already-assembled video.
 * Replaces videoPath in-place. Pass style='none' to skip.
 */
export async function burnSubtitles(params: {
  videoPath: string;
  scenes: { narration?: string; text?: string; duration: number }[];
  format: VideoFormat;
  style: SubtitleStyle;
  options?: SubtitleOptions;
}): Promise<void> {
  const { videoPath, scenes, format, style, options = {} } = params;

  if (style === 'none') return;

  const hasNarration = scenes.some(s => s.narration?.trim() || s.text?.trim());
  if (!hasNarration) return;

  const assDir = path.dirname(videoPath);
  const assPath = path.join(assDir, `subs_${Date.now()}.ass`);
  const tmpOut = videoPath.replace(/\.mp4$/, '_subs.mp4');

  let currentTime = 0;
  const entries: KaraokeSceneEntry[] = scenes.map(s => {
    const entry: KaraokeSceneEntry = {
      narration: s.narration || '',
      text: s.text || s.narration || '',
      startTime: currentTime,
      duration: s.duration,
    };
    currentTime += s.duration;
    return entry;
  });

  const assContent = generateSubtitleASS(entries, format, style, options);
  await fs.writeFile(assPath, assContent, 'utf-8');

  // Escape path for ffmpeg ass filter (colons are special chars in filtergraph)
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  try {
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-i', videoPath,
      '-vf', `ass=${escapedAss}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-c:a', 'copy',
      tmpOut,
    ]);
    await fs.rename(tmpOut, videoPath);
    console.log(`[subtitles] Style="${style}" burned into ${path.basename(videoPath)}`);
  } catch (err: any) {
    console.warn(`[subtitles] Burn failed (${style}): ${err.message} — skipping subtitles`);
    try { await fs.unlink(tmpOut); } catch {}
  } finally {
    try { await fs.unlink(assPath); } catch {}
  }
}

/** @deprecated Use burnSubtitles instead */
export const burnKaraokeSubtitles = (params: {
  videoPath: string;
  scenes: { narration?: string; duration: number }[];
  format: VideoFormat;
}) => burnSubtitles({ ...params, style: 'karaoke' });

export async function assembleFromClips(params: {
  scenes: VeoScene[];
  outputPath: string;
  tempDir: string;
  onProgress?: (pct: number, msg: string) => void;
}): Promise<void> {
  const { scenes, outputPath, tempDir, onProgress } = params;
  const ffmpegPath = FFMPEG_BIN;

  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const muxedPaths: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const muxed = path.join(tempDir, `muxed_${i}.mp4`);
    onProgress?.(Math.round((i / scenes.length) * 80), `Микширование сцены ${i + 1}/${scenes.length}...`);

    if (scene.audioPath) {
      // Clip video to exactly scene.duration — TTS is already sped-up to fit.
      // Do NOT extend beyond scene.duration: stock clips are trimmed to that length,
      // and extending would freeze on the last frame AND break subtitle timing.
      const clipDur = scene.duration;

      const args = [
        '-i', scene.clipPath,
        '-i', scene.audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-t', String(clipDur),
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k',
        '-af', 'apad',
        '-shortest',
        '-y', muxed,
      ];
      await execFileAsync(ffmpegPath, args);
    } else {
      // Add silent audio track so all clips are concat-compatible
      const args = [
        '-i', scene.clipPath,
        '-f', 'lavfi', '-t', String(scene.duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', String(scene.duration),
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest',
        '-y', muxed,
      ];
      await execFileAsync(ffmpegPath, args);
    }

    muxedPaths.push(muxed);
  }

  onProgress?.(85, 'Сборка финального видео...');

  const concatFile = path.join(tempDir, 'concat.txt');
  await fs.writeFile(concatFile, muxedPaths.map((p) => `file '${p}'`).join('\n'));

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(concatFile)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c:v copy', '-c:a aac', '-b:a 128k'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg concat error: ${err.message}`)))
      .run();
  });

  onProgress?.(95, 'Очистка временных файлов...');
  await fs.rm(tempDir, { recursive: true, force: true });
}

// ── Image-based assembly ──────────────────────────────────────────────────────

export async function assembleVideo(params: {
  scenes: AssemblerScene[];
  format: VideoFormat;
  outputPath: string;
  tempDir: string;
  onProgress?: (pct: number, msg: string) => void;
}): Promise<void> {
  const { scenes, format, outputPath, tempDir, onProgress } = params;

  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const hasAnyAudio = scenes.some((s) => s.audioPath);
  const clipPaths: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const clipPath = path.join(tempDir, `clip_${i}.mp4`);
    onProgress?.(
      Math.round((i / scenes.length) * 80),
      `Рендер сцены ${i + 1}/${scenes.length}...`
    );

    if (hasAnyAudio) {
      // All clips must have audio stream for seamless concat
      if (scenes[i].audioPath) {
        await makeClip(scenes[i], format, clipPath);
      } else {
        await makeClipWithSilence(scenes[i], format, clipPath);
      }
    } else {
      // No audio at all — use simple pipeline
      await new Promise<void>((resolve, reject) => {
        const { w, h } = FORMAT_SIZES[format];
        const fps = 25;
        const fontSize = Math.max(28, Math.round(w * 0.038));
        const boxPad = Math.round(fontSize * 0.5);
        const yPos = `h-${Math.round(h * 0.08)}-text_h`;
        const safeText = escapeText(scenes[i].text);
        const fontFilter = safeText
          ? `drawtext=text='${safeText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${yPos}:box=1:boxcolor=black@0.65:boxborderw=${boxPad}`
          : 'null';
        const videoFilter = [
          `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
          `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
          fontFilter,
        ].filter((f) => f !== 'null').join(',');

        ffmpeg()
          .input(scenes[i].imagePath)
          .inputOptions(['-loop 1', `-t ${scenes[i].duration}`])
          .videoFilter(videoFilter)
          .outputOptions([
            `-t ${scenes[i].duration}`,
            '-c:v libx264', '-preset ultrafast', '-crf 26', '-pix_fmt yuv420p', `-r ${fps}`,
          ])
          .output(clipPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(new Error(`FFmpeg clip error: ${err.message}`)))
          .run();
      });
    }

    clipPaths.push(clipPath);
  }

  onProgress?.(85, 'Сборка финального видео...');

  const concatFile = path.join(tempDir, 'concat.txt');
  const concatContent = clipPaths.map((p) => `file '${p}'`).join('\n');
  await fs.writeFile(concatFile, concatContent);

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg()
      .input(concatFile)
      .inputOptions(['-f concat', '-safe 0']);

    if (hasAnyAudio) {
      cmd.outputOptions(['-c:v copy', '-c:a aac', '-b:a 128k']);
    } else {
      cmd.outputOptions(['-c copy']);
    }

    cmd
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`FFmpeg concat error: ${err.message}`)))
      .run();
  });

  onProgress?.(95, 'Очистка временных файлов...');
  await fs.rm(tempDir, { recursive: true, force: true });
}

/**
 * Mix background music into a finished video in-place.
 * Voice stays at full volume; music is quieter (default 18%).
 */
export async function mixBackgroundMusic(params: {
  videoPath: string;
  musicPath: string;
  musicVolume?: number;
}): Promise<void> {
  const { videoPath, musicPath, musicVolume = 0.18 } = params;
  const tmpOut = videoPath.replace(/\.mp4$/, '_music.mp4');
  try {
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-loglevel', 'error',
      '-i', videoPath,
      '-i', musicPath,
      '-filter_complex',
      `[0:a]volume=1.0[voice];[1:a]volume=${musicVolume}[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=2[out]`,
      '-map', '0:v',
      '-map', '[out]',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k',
      tmpOut,
    ], { timeout: 180_000, maxBuffer: 50 * 1024 * 1024 });
    await fs.rename(tmpOut, videoPath);
    console.log(`[music] Mixed into video (music volume=${musicVolume})`);
  } catch (err: any) {
    console.warn(`[music] Mix failed: ${err.message} — skipping music`);
    try { await fs.unlink(tmpOut); } catch {}
  }
}
