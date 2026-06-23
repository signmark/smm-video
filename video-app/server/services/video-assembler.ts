import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import type { VideoFormat, SubtitleStyle } from '../db.js';
import { DATA_DIR } from '../db.js';

// Prefer system ffmpeg (works on Alpine/musl in Docker); fall back to installer binary (Replit/glibc)
function resolveFfmpegPath(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return ffmpegInstaller.path;
}
const FFMPEG_BIN = resolveFfmpegPath();
const FFPROBE_BIN = FFMPEG_BIN === 'ffmpeg' ? 'ffprobe' : FFMPEG_BIN.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
ffmpeg.setFfmpegPath(FFMPEG_BIN);
const execFileAsync = promisify(execFile);

/**
 * Returns the actual duration of a media file in seconds via ffprobe.
 * Falls back to 0 on error.
 */
export async function probeActualDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 15_000 });
    const d = parseFloat(stdout.trim());
    return isNaN(d) ? 0 : d;
  } catch {
    return 0;
  }
}

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

/**
 * Format-aware font size for subtitle ASS styles.
 * 16:9 videos have much wider frames (w=1920 vs 1080) so a naive w*factor gives
 * huge text in landscape mode. Scale down by 0.58× for 16:9 to keep absolute
 * pixel size comparable across all three formats.
 */
function formatAwareFontSize(w: number, format: VideoFormat, baseFactor: number, sizeMultiplier = 1.0): number {
  const scale = format === '16:9' ? 0.58 : 1.0;
  return Math.round(Math.round(w * baseFactor * scale) * sizeMultiplier);
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

/**
 * Create a static (looped still-image) MP4 clip from a JPEG frame.
 * Used as a fallback when FAL animation fails for a scene.
 * Output is H.264/AAC silent clip at 25fps, exactly durationSeconds long.
 */
export async function makeStaticClipFromImage(params: {
  imagePath: string;
  durationSeconds: number;
  outputPath: string;
  /** Apply Ken Burns zoom/pan effect (default: true). */
  kenBurns?: boolean;
  /** Target format for scale filter. When provided, output is scaled to match. */
  format?: VideoFormat;
  /** Scene index — selects Ken Burns preset (0=zoom-in-center, 1=zoom-in-up, 2=zoom-in-corner). */
  sceneIndex?: number;
}): Promise<void> {
  const { imagePath, durationSeconds, outputPath, kenBurns = true, format, sceneIndex = 0 } = params;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const totalFrames = Math.ceil(durationSeconds * 25);
  const { w: targetW, h: targetH } = format ? FORMAT_SIZES[format] : { w: 1080, h: 1920 };
  const scaleStr = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;

  // 3 Ken Burns presets cycled by scene index
  const preset = sceneIndex % 3;
  const kbFilters: string[] = [
    // 0: slow zoom-in from center
    `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:fps=25`,
    // 1: zoom-in with upward pan
    `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih*0.60-(ih/zoom/2)':d=${totalFrames}:fps=25`,
    // 2: zoom-in from upper-left corner
    `zoompan=z='min(zoom+0.0015,1.5)':x='iw*0.30-(iw/zoom/2)':y='ih*0.30-(ih/zoom/2)':d=${totalFrames}:fps=25`,
  ];
  const vfFilter = kenBurns
    ? `${kbFilters[preset]},${scaleStr}`
    : scaleStr;

  const args = [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-t', String(durationSeconds), '-i', imagePath,
    '-f', 'lavfi', '-t', String(durationSeconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(durationSeconds),
    '-vf', vfFilter,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ];
  await execFileAsync(FFMPEG_BIN, args, { timeout: 120_000 });
}

/**
 * Creates a title-card clip — solid-colour background with centred text overlay.
 * Useful as a 0.5–1s opener before scene 1 (hook moment).
 *
 * @param style
 *   'white-on-black' — white text on black background (default)
 *   'black-on-white' — black text on white background
 *   'accent'         — white text on deep navy (#0d1117) — cinematic look
 */
export async function makeTitleCardClip(params: {
  text: string;
  durationSeconds: number;
  outputPath: string;
  format: VideoFormat;
  style?: 'white-on-black' | 'black-on-white' | 'accent';
}): Promise<void> {
  const { text, durationSeconds, outputPath, format, style = 'white-on-black' } = params;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const { w, h } = FORMAT_SIZES[format];
  const bgColors: Record<string, string> = {
    'white-on-black': '0x0d0d0d',
    'black-on-white': '0xf5f5f5',
    'accent':         '0x0d1117',
  };
  const textColors: Record<string, string> = {
    'white-on-black': 'white',
    'black-on-white': 'black',
    'accent':         'white',
  };
  const bg = bgColors[style];
  const tc = textColors[style];

  // Escape text: colons, backslashes, single-quotes for ffmpeg drawtext
  const safeText = text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");

  const fontSize = Math.round(w * 0.072);
  const shadowColor = style === 'black-on-white' ? 'white' : 'black';

  const vf = [
    `drawtext=fontsize=${fontSize}:fontcolor=${tc}:shadowcolor=${shadowColor}:shadowx=3:shadowy=3`,
    `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
    `text='${safeText}'`,
    `x=(w-text_w)/2`,
    `y=(h-text_h)/2`,
  ].join(':');

  const args = [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-t', String(durationSeconds), '-i', `color=c=${bg}:s=${w}x${h}:rate=25`,
    '-f', 'lavfi', '-t', String(durationSeconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(durationSeconds),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ];
  await execFileAsync(FFMPEG_BIN, args, { timeout: 60_000 });
}

// ── Veo clip assembly (video clips + TTS audio → final mp4) ──────────────────

export interface VeoScene {
  clipPath: string;
  duration: number;
  audioPath?: string;
  audioDuration?: number;
  narration?: string;
  text?: string;
  /** Viral structure role — drives per-scene colour grading. */
  role?: 'hook' | 'body' | 'cta';
}

/** Word-level timestamp returned by OpenAI Whisper transcription. */
export interface WordTimestamp {
  word: string;
  /** Start time in seconds relative to the audio clip. */
  start: number;
  /** End time in seconds relative to the audio clip. */
  end: number;
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
  const fontSize = formatAwareFontSize(w, format, 0.040, options.sizeMultiplier ?? 1);
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
  const fontSize = formatAwareFontSize(w, format, 0.038, options.sizeMultiplier ?? 1);
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
  const fontSize = formatAwareFontSize(w, format, 0.038, options.sizeMultiplier ?? 1);
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

/** Style: TikTok — one word at a time, large bold font with shadow */
function generateTiktokASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = formatAwareFontSize(w, format, 0.075, options.sizeMultiplier ?? 1);
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.12);
  // BorderStyle=1 (outline+shadow), bold, large — Outline=5px, Shadow=3px for max readability
  const styleLine = `Style: TikTok,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,3,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const lines: string[] = [];
  for (const s of scenes) {
    const words = s.narration.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    // Proportional timing: longer words (more chars) get more screen time to
    // approximate TTS speech duration. Strip punctuation for the char count so
    // trailing commas/dots don't inflate short words.
    const charCounts = words.map(w => w.replace(/[^\p{L}\p{N}]/gu, '').length || 1);
    const totalChars = charCounts.reduce((a, b) => a + b, 0);
    const minWordDur = Math.min(0.20, s.duration / words.length);

    let cursor = s.startTime;
    words.forEach((word, i) => {
      const proportion = charCounts[i] / totalChars;
      const wordDur = Math.max(minWordDur, s.duration * proportion);
      const start = cursor;
      const end = Math.min(start + wordDur, s.startTime + s.duration);
      cursor += wordDur;
      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},TikTok,,0,0,0,,{\\fad(80,80)}${word}`);
    });
  }

  return header + '\n' + lines.join('\n') + '\n';
}

/** Style: word-by-word accumulate — words appear one-by-one, stay on screen */
function generateWordByWordASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = formatAwareFontSize(w, format, 0.038, options.sizeMultiplier ?? 1);
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

/**
 * Style: word-timed — each word appears at its exact spoken timestamp (from Whisper).
 * `wordTimestamps[i]` is the array of word timestamps for scene i, where each `start`/`end`
 * is relative to the beginning of that scene's audio clip.
 * `sceneStartTimes[i]` is the absolute start time of scene i in the final video.
 */
function generateWordTimedASS(
  wordTimestamps: WordTimestamp[][],
  sceneStartTimes: number[],
  format: VideoFormat,
  options: SubtitleOptions = {},
): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = formatAwareFontSize(w, format, 0.072, options.sizeMultiplier ?? 1);
  const primaryColor = hexToAssColor(options.color ?? '#ffffff');
  const marginV = Math.round(h * 0.10);
  const styleLine = `Style: WordTimed,${font},${fontSize},${primaryColor},${primaryColor},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,40,40,${marginV},1`;
  const header = makeAssHeader(w, h, styleLine);

  const lines: string[] = [];
  for (let si = 0; si < wordTimestamps.length; si++) {
    const sceneOffset = sceneStartTimes[si] ?? 0;
    for (const wt of wordTimestamps[si]) {
      const absStart = sceneOffset + wt.start;
      const absEnd = sceneOffset + wt.end;
      if (absEnd <= absStart) continue;
      // Pop-in fade: 60ms fade-in, 60ms fade-out; highlight colour on current word
      lines.push(
        `Dialogue: 0,${formatAssTime(absStart)},${formatAssTime(absEnd)},WordTimed,,0,0,0,,{\\fad(60,60)\\c&H0000FFFF&}${wt.word}{\\c&H00FFFFFF&}`,
      );
    }
  }

  return header + '\n' + lines.join('\n') + '\n';
}

/** Style: cinematic — large uppercase text, center-screen, blur-reveal + scale animation — real movie trailer look */
function generateCinematicASS(scenes: KaraokeSceneEntry[], format: VideoFormat, options: SubtitleOptions = {}): string {
  const { w, h } = FORMAT_SIZES[format];
  const font = options.font ?? 'DejaVu Sans';
  const fontSize = formatAwareFontSize(w, format, 0.068, options.sizeMultiplier ?? 1);
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
  const fontSize = formatAwareFontSize(w, format, 0.042, options.sizeMultiplier ?? 1);
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
  const fontSize = formatAwareFontSize(w, format, 0.036, options.sizeMultiplier ?? 1);
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
    // 'word-timed' is handled directly in burnSubtitles (needs wordTimestamps).
    // Fallback to tiktok here if called without them.
    case 'word-timed': return generateTiktokASS(scenes, format, options);
    case 'karaoke':
    default:            return generateKaraokeASS(scenes, format, options);
  }
}

/**
 * Burns subtitles into an already-assembled video.
 * Replaces videoPath in-place. Pass style='none' to skip.
 *
 * Pass `actualDurations` (returned by assembleFromClips) to align subtitles
 * to real clip lengths instead of the planned durations — prevents timing drift.
 */
export async function burnSubtitles(params: {
  videoPath: string;
  scenes: { narration?: string; text?: string; duration: number }[];
  format: VideoFormat;
  style: SubtitleStyle;
  options?: SubtitleOptions;
  actualDurations?: number[];
  /**
   * Word-level timestamps per scene (from getWordTimestamps in tts-generator).
   * Required for style='word-timed'. Each inner array corresponds to one scene.
   * `start`/`end` values are relative to the scene's audio clip start.
   */
  wordTimestamps?: WordTimestamp[][];
  /**
   * Duration of silent gap inserted between scenes (e.g. flash-cut = 0.12s).
   * When provided, each scene's subtitle start time is shifted forward by
   * `sceneIndex * interSceneGapSec` so subtitles stay in sync with the actual
   * video timeline that includes these inter-scene gaps.
   */
  interSceneGapSec?: number;
  /**
   * Crossfade duration between scenes (seconds). When > 0, each scene's start
   * time is shifted back by `sceneIndex * crossfadeSec` because xfade overlaps
   * clips. Must match the crossfadeDuration passed to assembleFromClips.
   */
  crossfadeSec?: number;
}): Promise<void> {
  const { videoPath, scenes, format, style, options = {}, actualDurations, wordTimestamps, interSceneGapSec = 0, crossfadeSec = 0 } = params;

  if (style === 'none') return;

  const hasNarration = scenes.some(s => s.narration?.trim() || s.text?.trim());
  if (!hasNarration) return;

  const assDir = path.dirname(videoPath);
  const assPath = path.join(assDir, `subs_${Date.now()}.ass`);
  const tmpOut = videoPath.replace(/\.mp4$/, '_subs.mp4');

  let currentTime = 0;
  const entries: KaraokeSceneEntry[] = scenes.map((s, i) => {
    // Use probed actual duration when available; fall back to planned duration
    const dur = (actualDurations && actualDurations[i] > 0) ? actualDurations[i] : s.duration;
    // Account for inter-scene gaps (flash-cut +gap) and crossfade overlaps (-overlap).
    // With crossfade, each scene starts crossfadeSec earlier than plain concatenation.
    const startTime = currentTime + i * interSceneGapSec - i * crossfadeSec;
    const entry: KaraokeSceneEntry = {
      narration: s.narration || '',
      text: s.text || s.narration || '',
      startTime: Math.max(0, startTime),
      duration: dur,
    };
    currentTime += dur;
    return entry;
  });

  // word-timed: use Whisper word timestamps with absolute scene offsets
  let assContent: string;
  if (style === 'word-timed' && wordTimestamps && wordTimestamps.length > 0) {
    const sceneStartTimes = entries.map(e => e.startTime);
    assContent = generateWordTimedASS(wordTimestamps, sceneStartTimes, format, options);
  } else {
    assContent = generateSubtitleASS(entries, format, style, options);
  }
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

/** Per-role colour grading filters applied in the mux step of assembleFromClips. */
const ROLE_COLOR_FILTERS: Partial<Record<NonNullable<VeoScene['role']>, string>> = {
  // hook: cold/dramatic — slight blue push, boosted contrast, desaturated
  hook: 'colorchannelmixer=rr=0.92:gg=0.95:bb=1.10,eq=contrast=1.25:saturation=0.80',
  // cta: warm/golden — red/green lift, contrast + saturation boost (reward signal)
  cta:  'colorchannelmixer=rr=1.10:gg=1.03:bb=0.88,eq=contrast=1.10:saturation=1.15',
  // body: neutral — no extra filter
};

export async function assembleFromClips(params: {
  scenes: VeoScene[];
  outputPath: string;
  tempDir: string;
  /**
   * Target format — ALL clips are normalised to FORMAT_SIZES[format] during
   * the mux step so that different-resolution FAL/stock clips can be safely
   * stream-copy concatenated afterwards.
   */
  format: VideoFormat;
  onProgress?: (pct: number, msg: string) => void;
  /**
   * Crossfade duration in seconds between clips.
   * 0 = hard cut (default). Use 0.3–0.5 for smooth dissolve transitions.
   * Requires re-encoding, so it's slower than stream copy.
   */
  crossfadeDuration?: number;
  /**
   * Insert a 3-frame (0.12 s) white flash between every scene transition.
   * Creates a "pattern interrupt" that keeps attention in viral Reels/TikTok.
   * Incompatible with crossfadeDuration > 0 (crossfade takes precedence).
   */
  flashCut?: boolean;
  /**
   * Burn scene.text as a large centered overlay on every scene whose role='hook'.
   * Mimics TikTok-style text-on-video for maximum hook impact.
   * Skipped silently for scenes without text or role.
   */
  hookTextOverlay?: boolean;
}): Promise<number[]> {
  const { scenes, outputPath, tempDir, format, onProgress, crossfadeDuration = 0, flashCut = false, hookTextOverlay = false } = params;
  const { w: targetW, h: targetH } = FORMAT_SIZES[format];
  const scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const ffmpegPath = FFMPEG_BIN;

  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const muxedPaths: string[] = [];
  const actualDurations: number[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const muxed = path.join(tempDir, `muxed_${i}.mp4`);
    onProgress?.(Math.round((i / scenes.length) * 75), `Микширование сцены ${i + 1}/${scenes.length}...`);

    // Re-encode with stream_loop so that:
    //   • clips shorter than clipDur (e.g. WAN 81-frame @ 24fps = 3.375s < 5s) are looped
    //   • output is frame-accurate (no keyframe-boundary frozen last-frame with stream copy)
    //   • ALL clips are scaled/padded to exactly targetW×targetH (normalises FAL/stock resolution
    //     differences — Seedance 720p, WAN 480p, stock 1080p all become the same canvas)
    //   • all clips leave this step at the same codec/fps, making concat stream-copy safe
    // Use actual audio duration when available — this drives clip length so voice perfectly
    // fills every scene with no trailing silence and subtitles stay in sync.
    const clipDur = (scene.audioDuration && scene.audioDuration > 0.5) ? scene.audioDuration : scene.duration;

    // Build -vf chain: scale/pad normalisation + optional colour grade + optional hook text overlay
    const colorGrade = scene.role ? (ROLE_COLOR_FILTERS[scene.role] ?? '') : '';
    // Hook overlay: burn scene.text as large centered text for hook scenes (TikTok-style)
    const hookOverlayFilter = (hookTextOverlay && scene.role === 'hook' && scene.text?.trim())
      ? `drawtext=text='${escapeText(scene.text.trim().slice(0, 60))}':fontsize=${Math.round(targetW * 0.060)}:fontcolor=white:x=(w-text_w)/2:y=${Math.round(targetH * 0.15)}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(targetW * 0.012)}`
      : '';
    const vf = [scaleFilter, colorGrade, hookOverlayFilter].filter(Boolean).join(',');

    if (scene.audioPath) {
      const args = [
        '-y', '-loglevel', 'error',
        '-stream_loop', '-1', '-i', scene.clipPath,   // loop video input
        '-i', scene.audioPath,                         // audio input
        '-t', String(clipDur),                         // exact output length
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf', vf,                                     // normalise + colour grade
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        // Normalise sample rate to 44100 Hz — OpenAI TTS outputs 24000 Hz but flash/silence
        // clips use 44100 Hz; mismatched rates cause ffmpeg concat to produce wrong audio
        // timestamps (audio becomes ~1.5× too long in the final file).
        '-ar', '44100',
        '-af', `apad=whole_dur=${clipDur}`,            // pad audio silence to clipDur
        muxed,
      ];
      await execFileAsync(ffmpegPath, args, { timeout: 180_000 });
    } else {
      const args = [
        '-y', '-loglevel', 'error',
        '-stream_loop', '-1', '-i', scene.clipPath,
        '-f', 'lavfi', '-t', String(clipDur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', String(clipDur),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf', vf,                                     // normalise + colour grade
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        muxed,
      ];
      await execFileAsync(ffmpegPath, args, { timeout: 180_000 });
    }

    // After re-encode the probed duration should equal clipDur exactly.
    // We still probe so subtitle timing stays correct if something unexpected happened.
    const probed = await probeActualDuration(muxed);
    actualDurations.push(probed > 0 ? probed : scene.duration);
    muxedPaths.push(muxed);
  }

  onProgress?.(80, 'Сборка финального видео...');

  if (crossfadeDuration > 0 && muxedPaths.length > 1) {
    // ── Crossfade assembly via xfade + acrossfade filter_complex ─────────────
    await assemblWithCrossfade({
      muxedPaths,
      actualDurations,
      outputPath,
      crossfadeDuration,
      ffmpegPath,
    });
  } else {
    // ── Fast hard-cut concat (stream copy, optional flash-cut between scenes) ─
    // When flashCut=true, generate a single white flash clip (3 frames = 0.12 s)
    // and insert it between every pair of scene clips in the concat list.
    let concatEntries = muxedPaths;

    if (flashCut && muxedPaths.length > 1) {
      const flashPath = path.join(tempDir, 'flash.mp4');
      const flashDur = '0.12';
      await execFileAsync(ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-t', flashDur, '-i', `color=c=white:s=${targetW}x${targetH}:rate=25`,
        '-f', 'lavfi', '-t', flashDur, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', flashDur,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-r', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        flashPath,
      ], { timeout: 30_000 });

      // Interleave: [scene0, flash, scene1, flash, scene2, ...]
      concatEntries = [];
      for (let fi = 0; fi < muxedPaths.length; fi++) {
        concatEntries.push(muxedPaths[fi]);
        if (fi < muxedPaths.length - 1) concatEntries.push(flashPath);
      }
      console.log(`[assembleFromClips] Flash-cut inserted at ${muxedPaths.length - 1} transitions`);
    }

    const concatFile = path.join(tempDir, 'concat.txt');
    await fs.writeFile(concatFile, concatEntries.map((p) => `file '${p}'`).join('\n'));

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
  }

  onProgress?.(95, 'Очистка временных файлов...');
  await fs.rm(tempDir, { recursive: true, force: true });

  return actualDurations;
}

/**
 * Assemble muxed clips with xfade (video) + acrossfade (audio) transitions.
 * Requires re-encoding. Offsets are computed from actual probed durations.
 */
async function assemblWithCrossfade(params: {
  muxedPaths: string[];
  actualDurations: number[];
  outputPath: string;
  crossfadeDuration: number;
  ffmpegPath: string;
}): Promise<void> {
  const { muxedPaths, actualDurations, outputPath, crossfadeDuration, ffmpegPath } = params;
  const n = muxedPaths.length;
  const cf = crossfadeDuration;

  // Build filter_complex for N clips with xfade + acrossfade
  const filterParts: string[] = [];

  // Video xfade chain.
  // Correct formula: offset[i] = sum(d[0..i-1]) - i*cf
  // Each xfade "consumes" cf seconds from the timeline, so each subsequent
  // transition must be shifted back by cf relative to plain concatenation.
  let cumDur = 0;
  let prevVLabel = '[0:v]';
  for (let i = 1; i < n; i++) {
    cumDur += actualDurations[i - 1];
    const vOffset = Math.max(0, cumDur - i * cf);
    const outLabel = i === n - 1 ? '[vout]' : `[v${i}]`;
    filterParts.push(`${prevVLabel}[${i}:v]xfade=transition=fade:duration=${cf}:offset=${vOffset.toFixed(3)}${outLabel}`);
    prevVLabel = outLabel;
  }

  // Audio acrossfade chain (ffmpeg handles timing automatically via overlap)
  let prevALabel = '[0:a]';
  for (let i = 1; i < n; i++) {
    const outLabel = i === n - 1 ? '[aout]' : `[a${i}]`;
    filterParts.push(`${prevALabel}[${i}:a]acrossfade=d=${cf}:o=1${outLabel}`);
    prevALabel = outLabel;
  }

  const filterComplex = filterParts.join(';');
  const inputArgs: string[] = [];
  for (const p of muxedPaths) inputArgs.push('-i', p);

  await execFileAsync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    outputPath,
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
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
// ── Whoosh SFX at scene transitions ──────────────────────────────────────────

async function generateWhooshFile(outputPath: string): Promise<void> {
  await execFileAsync(FFMPEG_BIN, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'anoisesrc=c=white:d=0.3:a=0.9',
    '-af', 'bandpass=f=2200:width_type=h:width=4000,afade=in:d=0.02,afade=out:st=0.20:d=0.10,volume=2.0',
    '-t', '0.3', '-ar', '44100', outputPath,
  ], { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 });
  console.log(`[sfx] Generated whoosh: ${outputPath}`);
}

export async function mixWhooshSFX(params: {
  videoPath: string;
  sceneDurations: number[];
  volume?: number;
}): Promise<void> {
  const { videoPath, sceneDurations, volume = 0.55 } = params;

  // transition points = cumulative duration after each scene except the last
  const transitions: number[] = [];
  let t = 0;
  for (let i = 0; i < sceneDurations.length - 1; i++) {
    t += sceneDurations[i];
    transitions.push(t);
  }
  if (transitions.length === 0) return;

  const sfxDir = path.join(DATA_DIR, 'sfx');
  const whooshPath = path.join(sfxDir, 'whoosh.wav');
  await fs.mkdir(sfxDir, { recursive: true });
  const exists = await fs.access(whooshPath).then(() => true).catch(() => false);
  if (!exists) await generateWhooshFile(whooshPath);

  const n = transitions.length;
  const tmpOut = videoPath.replace(/\.mp4$/, '_sfx.mp4');

  // Build filter_complex: split whoosh N times, delay each to transition point
  const splitOuts = Array.from({ length: n }, (_, i) => `[ws${i}]`).join('');
  const splitFilter = `[1:a]asplit=${n}${splitOuts}`;
  const delayFilters = transitions.map((ts, i) => {
    const ms = Math.max(0, Math.round((ts - 0.12) * 1000));
    return `[ws${i}]adelay=${ms}|${ms},volume=${volume}[w${i}]`;
  });
  const mixIn = ['[0:a]', ...Array.from({ length: n }, (_, i) => `[w${i}]`)].join('');
  const mixFilter = `${mixIn}amix=inputs=${n + 1}:weights=${['1', ...Array(n).fill('1')].join(' ')}:duration=first:normalize=0[out]`;
  const filterComplex = [splitFilter, ...delayFilters, mixFilter].join(';');

  try {
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-loglevel', 'error',
      '-i', videoPath,
      '-i', whooshPath,
      '-filter_complex', filterComplex,
      '-map', '0:v', '-map', '[out]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      tmpOut,
    ], { timeout: 180_000, maxBuffer: 50 * 1024 * 1024 });
    await fs.rename(tmpOut, videoPath);
    console.log(`[sfx] Whoosh mixed at ${n} transitions`);
  } catch (err: any) {
    console.warn(`[sfx] Whoosh mix failed: ${err.message} — skipping`);
    try { await fs.unlink(tmpOut); } catch {}
  }
}

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
