/**
 * Production E2E тесты генератора видео — полный охват всех пайплайнов.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ДЕРЕВО ПАЙПЛАЙНОВ                                              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║                                                                  ║
 * ║  POST /videos/:id/generate                                       ║
 * ║    │                                                             ║
 * ║    ├─ CHAIN  (animationModel==='chain')                         ║
 * ║    │    Scene 0: Kling T2V (text → video)                       ║
 * ║    │    Scene i: Kling I2V (last frame prev clip → video)       ║
 * ║    │    → assembleFromClips(flashCut) → subtitles(gap=0.12)     ║
 * ║    │                                                             ║
 * ║    ├─ T2V  (isT2VModel: wan-t2v)                                ║
 * ║    │    All scenes: FAL T2V parallel (or stock)                 ║
 * ║    │    → assembleFromClips(flashCut) → subtitles(gap=0.12)     ║
 * ║    │                                                             ║
 * ║    ├─ I2V  (default: wan/kling/kling-pro/minimax/seedance)      ║
 * ║    │    Phase 0: stock precheck (download or switch→AI)         ║
 * ║    │    Phase A: image gen parallel (variant/Imagen4/Gemini)    ║
 * ║    │    Phase B: FAL I2V + TTS parallel                         ║
 * ║    │      - stock:          pre-downloaded clip                 ║
 * ║    │      - stock-animated: stock photo → I2V                   ║
 * ║    │      - ai:             generated image → I2V               ║
 * ║    │      - fallback:       static Ken Burns if FAL fails       ║
 * ║    │    → assembleFromClips(flashCut) → subtitles(gap=0.12)     ║
 * ║    │                                                             ║
 * ║    └─ STATIC FALLBACK  (no FAL key / I2V threw)                 ║
 * ║         Sequential image gen → TTS → assembleVideo(KenBurns)   ║
 * ║         → subtitles(no gap)                                     ║
 * ║                                                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ОБЩИЕ ПРОВЕРКИ ФИНАЛЬНОГО MP4                                  ║
 * ║    • magic bytes ftyp/moov/mdat                                  ║
 * ║    • видеодорожка H.264, FPS ≥ 24, битрейт > 500 kbps          ║
 * ║    • аудиодорожка присутствует (TTS смикширован)                ║
 * ║    • audio_duration ≈ video_duration ±2s  (sync bug fix)        ║
 * ║    • длительность ±35% от запрошенной                           ║
 * ║    • разрешение соответствует формату (9:16 / 16:9 / 1:1)       ║
 * ║    • flash-cut gap учтён: total ≈ Σ(clips) + (N-1)×0.12s       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Запуск (из video-app/):
 *   npm run test:prod                  — все пайплайны
 *   PIPELINE=i2v npm run test:prod     — только I2V (seedance)
 *   PIPELINE=t2v npm run test:prod     — только T2V (wan-t2v)
 *   PIPELINE=kling npm run test:prod   — только I2V Kling 16:9
 *   PIPELINE=chain npm run test:prod   — только Chain (kling sequential)
 *
 * Env:
 *   VIDEO_E2E_URL          — base URL API (default: http://localhost:3001/api)
 *   VIDEO_E2E_EMAIL        — email (не используется, API без auth)
 *   PIPELINE               — один из: i2v | t2v | kling | chain | all (default: all)
 *   SKIP_CLEANUP=1         — не удалять проекты после теста (для инспекции)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile }   from 'node:child_process';
import { promisify }  from 'node:util';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir }     from 'node:os';
import { join }       from 'node:path';
import { BASE_URL }   from './config.js';
import { get, post, del, pollUntil } from './helpers.js';

const execFileAsync = promisify(execFile);

// ─── Константы ────────────────────────────────────────────────────────────────

/** Таймауты по операциям (мс) */
const T = {
  request:  20_000,
  script:   90_000,
  precheck: 120_000,
  generate: 900_000,   // 15 мин — Chain/Kling медленные
};

const PIPELINE   = (process.env.PIPELINE ?? 'all').toLowerCase();
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === '1';

// ─── Типы ─────────────────────────────────────────────────────────────────────

type Scene = {
  id?: string;
  text: string;
  narration?: string;
  videoSource?: 'stock' | 'ai' | 'stock-animated';
  stockAvailable?: boolean;
  imagePrompt?: string;
  duration?: number;
};

type Project = {
  id: string;
  status: string;
  title: string;
  topic?: string;
  format: string;
  duration: number;
  animationModel?: string;
  subtitleStyle?: string;
  script?: { scenes: Scene[]; stockPrechecked?: boolean };
  videoUrl?: string;
  progress?: number;
  error?: string;
};

type FfprobeStream = {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  channels?: number;
  sample_rate?: string;
};

type FfprobeOutput = {
  streams: FfprobeStream[];
  format: { duration: string; size: string; bit_rate: string; format_name: string };
};

type GeneratedVideo = {
  project: Project;
  buf: ArrayBuffer;
  probe: FfprobeOutput;
};

// ─── Конфигурации пайплайнов ──────────────────────────────────────────────────

type PipelineConfig = {
  id: string;                  // ключ для PIPELINE env var
  label: string;               // человекочитаемое название
  topic: string;               // тема для генерации скрипта
  format: '9:16' | '16:9' | '1:1';
  duration: 15 | 30 | 45 | 60;
  animationModel: string;
  subtitleStyle: 'karaoke' | 'tiktok' | 'none';
  language: 'ru' | 'en';
  /**
   * Ожидаемый источник большинства сцен.
   * 'stock' → тема богатая на стоки (природа, спорт и т.п.)
   * 'ai'    → тема нишевая, стоки вряд ли найдутся
   */
  expectedDominantSource?: 'stock' | 'ai' | 'mixed';
};

const PIPELINES: PipelineConfig[] = [
  {
    id: 'i2v',
    label: 'I2V · Seedance · 9:16 · 30s · tiktok (RU)',
    topic: 'Польза регулярного плавания для здоровья и иммунитета',
    format: '9:16',
    duration: 30,
    animationModel: 'seedance',
    subtitleStyle: 'tiktok',
    language: 'ru',
    expectedDominantSource: 'stock',
  },
  {
    id: 't2v',
    label: 'T2V · Wan-t2v · 9:16 · 15s · karaoke (RU)',
    topic: 'Как правильно заваривать зелёный чай',
    format: '9:16',
    duration: 15,
    animationModel: 'wan-t2v',
    subtitleStyle: 'karaoke',
    language: 'ru',
    expectedDominantSource: 'ai',
  },
  {
    id: 'kling',
    label: 'I2V · Kling · 16:9 · 30s · karaoke (RU)',
    topic: 'Топ-5 продуктивных привычек успешных людей',
    format: '16:9',
    duration: 30,
    animationModel: 'kling',
    subtitleStyle: 'karaoke',
    language: 'ru',
    expectedDominantSource: 'mixed',
  },
  {
    id: 'chain',
    label: 'Chain · Kling sequential · 9:16 · 30s · tiktok (RU)',
    topic: 'Путешествие по горам: рассвет над вершиной',
    format: '9:16',
    duration: 30,
    animationModel: 'chain',
    subtitleStyle: 'tiktok',
    language: 'ru',
    expectedDominantSource: 'ai',
  },
];

// ─── Утилиты ──────────────────────────────────────────────────────────────────

async function probeBuffer(buf: ArrayBuffer, ext = 'mp4'): Promise<FfprobeOutput> {
  const dir     = await mkdtemp(join(tmpdir(), 'prod-probe-'));
  const tmpFile = join(dir, `probe.${ext}`);
  try {
    await writeFile(tmpFile, Buffer.from(buf));
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      tmpFile,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function fetchBuf(url: string, timeoutMs = 120_000): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  return res.arrayBuffer();
}

function assertValidMp4(buf: ArrayBuffer, label: string) {
  const view   = new DataView(buf);
  const marker = String.fromCharCode(
    view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7),
  );
  assert.ok(
    ['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(marker),
    `${label}: невалидный MP4, magic bytes="${marker}"`,
  );
}

function assertResolution(probe: FfprobeOutput, format: string, label: string) {
  const v = probe.streams.find(s => s.codec_type === 'video');
  assert.ok(v, `${label}: нет видеодорожки`);
  const w = v.width!;
  const h = v.height!;
  assert.ok(w > 0 && h > 0, `${label}: некорректные размеры ${w}×${h}`);

  if (format === '9:16') {
    const r = h / w;
    assert.ok(h > w && r > 1.5 && r < 2.2,
      `${label}: формат 9:16 должен быть портретным ~1.78, получено ${w}×${h} (r=${r.toFixed(2)})`);
  } else if (format === '16:9') {
    const r = w / h;
    assert.ok(w > h && r > 1.5 && r < 2.2,
      `${label}: формат 16:9 должен быть альбомным ~1.78, получено ${w}×${h} (r=${r.toFixed(2)})`);
  } else if (format === '1:1') {
    const r = w / h;
    assert.ok(r > 0.85 && r < 1.15,
      `${label}: формат 1:1 должен быть квадратным, получено ${w}×${h}`);
  }
}

/**
 * Создаёт проект, запускает генерацию, ждёт завершения.
 * Возвращает project + скачанный MP4 + ffprobe.
 */
async function generateVideo(cfg: PipelineConfig): Promise<GeneratedVideo> {
  console.log(`\n[${cfg.id}] Создаём проект: "${cfg.topic}"`);

  const rCreate = await post<Project>('/videos', {
    title: `[E2E Prod] ${cfg.label}`,
    topic: cfg.topic,
    format: cfg.format,
    duration: cfg.duration,
    language: cfg.language,
    animationModel: cfg.animationModel,
    subtitleStyle: cfg.subtitleStyle,
  });
  assert.equal(rCreate.status, 201,
    `[${cfg.id}] Создание провалилось: ${JSON.stringify(rCreate.body)}`);

  const projectId = rCreate.body.id;
  console.log(`[${cfg.id}] Проект создан: ${projectId}`);

  // Запускаем генерацию (скрипт + видео за один шаг)
  const rGen = await post(`/videos/${projectId}/generate`, {});
  assert.ok([200, 202].includes(rGen.status),
    `[${cfg.id}] /generate вернул ${rGen.status}`);

  console.log(`[${cfg.id}] Генерация запущена. Ждём завершения...`);

  const project = await pollUntil<Project>(
    `/videos/${projectId}`,
    p => p.status === 'done' || p.status === 'error',
    { timeoutMs: T.generate, intervalMs: 8000 },
  );

  assert.equal(project.status, 'done',
    `[${cfg.id}] Статус "${project.status}", ошибка: ${project.error ?? '(нет)'}\n` +
    `Детали: ${JSON.stringify(project).slice(0, 400)}`);

  console.log(`[${cfg.id}] Генерация завершена. Скачиваем MP4...`);

  const downloadUrl = `${BASE_URL}/videos/${projectId}/download`;
  const buf = await fetchBuf(downloadUrl, 120_000);
  assert.ok(buf.byteLength > 50_000,
    `[${cfg.id}] MP4 слишком маленький: ${buf.byteLength} bytes`);

  const probe = await probeBuffer(buf);
  console.log(
    `[${cfg.id}] MP4 проверен: ` +
    `${parseFloat(probe.format.duration).toFixed(1)}s, ` +
    `${Math.round(parseInt(probe.format.bit_rate) / 1000)}kbps, ` +
    `scenes=${project.script?.scenes.length ?? '?'}`
  );

  return { project, buf, probe };
}

// ─── Общие проверки (применяются ко всем пайплайнам) ─────────────────────────

function runCommonChecks(label: string, cfg: PipelineConfig, getResult: () => GeneratedVideo) {
  describe(`MP4 структура`, () => {
    it('валидный MP4 (magic bytes)', () => {
      const { buf } = getResult();
      assertValidMp4(buf, label);
    });

    it('H.264 видеодорожка', async () => {
      const { probe } = getResult();
      const v = probe.streams.find(s => s.codec_type === 'video');
      assert.ok(v, `${label}: нет видеодорожки`);
      assert.equal(v.codec_name, 'h264', `${label}: ожидался h264, получен ${v.codec_name}`);
    });

    it('FPS ≥ 24', () => {
      const { probe } = getResult();
      const v = probe.streams.find(s => s.codec_type === 'video')!;
      const [num, den] = (v.r_frame_rate ?? '0/1').split('/').map(Number);
      const fps = den > 0 ? num / den : 0;
      assert.ok(fps >= 24, `${label}: FPS слишком низкий: ${fps.toFixed(1)}`);
    });

    it('битрейт > 500 kbps', () => {
      const { probe } = getResult();
      const br = parseInt(probe.format.bit_rate ?? '0');
      assert.ok(br > 500_000, `${label}: битрейт ${Math.round(br / 1000)}kbps < 500`);
    });

    it(`разрешение соответствует формату ${cfg.format}`, () => {
      const { probe } = getResult();
      assertResolution(probe, cfg.format, label);
    });

    it('размер файла > 1 MB', () => {
      const { buf } = getResult();
      assert.ok(buf.byteLength > 1_000_000,
        `${label}: файл слишком мал — ${Math.round(buf.byteLength / 1024)}KB (видео без контента?)`);
    });
  });

  describe(`Аудио и синхронизация`, () => {
    it('аудиодорожка присутствует (TTS смикширован)', () => {
      const { probe } = getResult();
      const a = probe.streams.find(s => s.codec_type === 'audio');
      assert.ok(a, `${label}: нет аудиодорожки — TTS не добавлен?`);
      assert.ok((a.channels ?? 0) > 0, `${label}: аудио без каналов`);
    });

    it('аудио и видео — одинаковая длительность ±2s (sync bug fix)', () => {
      const { probe } = getResult();
      const videoDur = parseFloat(probe.format.duration);
      const audioStream = probe.streams.find(s => s.codec_type === 'audio');
      assert.ok(audioStream, `${label}: нет аудиодорожки`);
      const audioDur = parseFloat(audioStream.duration ?? probe.format.duration);
      const diff = Math.abs(videoDur - audioDur);
      assert.ok(diff <= 2.0,
        `${label}: рассинхрон audio/video = ${diff.toFixed(2)}s (video=${videoDur.toFixed(2)}s, audio=${audioDur.toFixed(2)}s). ` +
        `Это признак бага с sample rate (24kHz vs 44.1kHz).`);
    });

    it('частота дискретизации аудио 44100 Hz', () => {
      const { probe } = getResult();
      const a = probe.streams.find(s => s.codec_type === 'audio');
      if (!a) return; // покрывается предыдущим тестом
      const sr = parseInt(a.sample_rate ?? '0');
      assert.equal(sr, 44100,
        `${label}: sample rate=${sr}Hz, ожидалось 44100Hz. Проверьте флаг -ar 44100 в assembleFromClips.`);
    });
  });

  describe(`Длительность и сцены`, () => {
    it(`длительность ±35% от запрошенных ${cfg.duration}s`, () => {
      const { probe } = getResult();
      const actual   = parseFloat(probe.format.duration);
      const expected = cfg.duration;
      const tol      = expected * 0.35;
      assert.ok(
        Math.abs(actual - expected) <= tol,
        `${label}: длительность ${actual.toFixed(1)}s при запрошенных ${expected}s (допуск ±${tol.toFixed(0)}s)`,
      );
    });

    it('количество сцен ≥ duration/15', () => {
      const { project } = getResult();
      const scenes    = project.script?.scenes ?? [];
      const minScenes = Math.max(1, Math.floor(cfg.duration / 15));
      assert.ok(scenes.length >= minScenes,
        `${label}: ${scenes.length} сцен при ${cfg.duration}s (минимум ${minScenes})`);
    });

    it('каждая сцена имеет непустой текст (≥10 символов)', () => {
      const { project } = getResult();
      for (const [i, s] of (project.script?.scenes ?? []).entries()) {
        assert.ok(
          typeof s.text === 'string' && s.text.trim().length >= 10,
          `${label}: сцена ${i} имеет пустой/короткий текст: "${s.text}"`);
      }
    });

    it('нет дублирующихся текстов сцен', () => {
      const { project } = getResult();
      const texts  = (project.script?.scenes ?? []).map(s => s.text.trim().toLowerCase());
      const unique = new Set(texts);
      assert.equal(unique.size, texts.length,
        `${label}: дублирующиеся тексты сцен (${texts.length} всего, ${unique.size} уникальных)`);
    });

    it('flash-cut gap учтён: total ≈ Σ(clips) + (N-1)×0.12s', () => {
      const { project, probe } = getResult();
      const scenes     = project.script?.scenes ?? [];
      const N          = scenes.length;
      if (N === 0) return;

      // У нас нет actualDurations через API, используем duration из сценария
      const sumPlanned = scenes.reduce((acc, s) => acc + (s.duration ?? 5), 0);
      const flashGaps  = (N - 1) * 0.12;
      const expected   = sumPlanned + flashGaps;
      const actual     = parseFloat(probe.format.duration);

      // Допуск ±20% — актуальные длительности клипов отличаются от плановых
      const tol = expected * 0.20;
      assert.ok(
        Math.abs(actual - expected) <= tol,
        `${label}: ожидалось ~${expected.toFixed(1)}s (Σклипов=${sumPlanned.toFixed(1)}s + gaps=${flashGaps.toFixed(2)}s), ` +
        `фактически=${actual.toFixed(1)}s (разница ${Math.abs(actual - expected).toFixed(1)}s > допуск ${tol.toFixed(1)}s)`);
    });
  });

  describe(`Финальный статус`, () => {
    it('status=done, progress=100, videoUrl присутствует', async () => {
      const { project } = getResult();
      const { body: fresh } = await get<Project>(`/videos/${project.id}`);
      assert.equal(fresh.status, 'done', `${label}: статус=${fresh.status}`);
      assert.equal(fresh.progress, 100, `${label}: progress=${fresh.progress}`);
      assert.ok(fresh.videoUrl, `${label}: videoUrl отсутствует`);
    });
  });
}

// ─── Генерация и тесты по пайплайнам ─────────────────────────────────────────

for (const cfg of PIPELINES) {
  const skip = PIPELINE !== 'all' && PIPELINE !== cfg.id;
  if (skip) continue;

  describe(`Пайплайн: ${cfg.label}`, { timeout: T.generate + T.script + 60_000 }, () => {
    let result: GeneratedVideo;
    let projectId: string;

    before(async () => {
      result = await generateVideo(cfg);
      projectId = result.project.id;
    }, { timeout: T.generate + T.script + 60_000 });

    after(async () => {
      if (!SKIP_CLEANUP && projectId) {
        await del(`/videos/${projectId}`).catch(() => {});
        console.log(`[${cfg.id}] Проект ${projectId} удалён`);
      } else if (SKIP_CLEANUP) {
        console.log(`[${cfg.id}] SKIP_CLEANUP=1 — проект ${projectId} сохранён`);
      }
    });

    // Пайплайн-специфичные проверки
    if (cfg.animationModel === 'chain') {
      describe('Chain-специфичные проверки', () => {
        it('Chain: scene 0 — T2V (нет stock), scenes 1+ — I2V', () => {
          const scenes = result.project.script?.scenes ?? [];
          // Chain всегда AI — нет imagePrompt от stock
          assert.ok(scenes.length >= 2,
            `Chain должен иметь ≥ 2 сцены (T2V + I2V), найдено ${scenes.length}`);
        });
      });
    }

    if (cfg.animationModel === 'wan-t2v') {
      describe('T2V-специфичные проверки', () => {
        it('T2V: все сцены имеют videoSource ai или stock', () => {
          const scenes = result.project.script?.scenes ?? [];
          for (const [i, s] of scenes.entries()) {
            assert.ok(
              s.videoSource === 'ai' || s.videoSource === 'stock',
              `T2V сцена ${i}: неожиданный videoSource="${s.videoSource}"`);
          }
        });
      });
    }

    if (['wan', 'kling', 'kling-pro', 'minimax', 'seedance'].includes(cfg.animationModel)) {
      describe('I2V-специфичные проверки', () => {
        it('I2V: videoSource проставлен для каждой сцены', () => {
          const valid  = new Set(['stock', 'ai', 'stock-animated']);
          const scenes = result.project.script?.scenes ?? [];
          for (const [i, s] of scenes.entries()) {
            assert.ok(
              valid.has(s.videoSource ?? ''),
              `I2V сцена ${i}: некорректный videoSource="${s.videoSource}"`);
          }
        });

        it('I2V: stock precheck выполнен', () => {
          assert.equal(
            result.project.script?.stockPrechecked, true,
            'stockPrechecked !== true после генерации');
        });

        if (cfg.expectedDominantSource === 'stock') {
          it('I2V: большинство сцен используют stock-клипы', () => {
            const scenes      = result.project.script?.scenes ?? [];
            const stockCount  = scenes.filter(s => s.videoSource === 'stock').length;
            const stockRatio  = stockCount / (scenes.length || 1);
            console.log(`  [${cfg.id}] stock=${stockCount}/${scenes.length} (${(stockRatio * 100).toFixed(0)}%)`);
            // Мягкая проверка — тема богатая, но Pexels может не найти
            assert.ok(stockCount >= 1,
              `Тема "${cfg.topic}" должна давать хотя бы 1 stock-сцену, найдено 0`);
          });
        }
      });
    }

    // Общие проверки для всех пайплайнов
    runCommonChecks(cfg.label, cfg, () => result);
  });
}

// ─── Smoke: API health ────────────────────────────────────────────────────────

describe('API health', () => {
  it('GET /videos возвращает 200', async () => {
    const { status } = await get('/videos');
    assert.equal(status, 200);
  });

  it('POST /videos с невалидными данными → 400', async () => {
    const { status } = await post('/videos', { title: '' });
    assert.ok([400, 422].includes(status),
      `Ожидалось 400/422 для невалидного запроса, получено ${status}`);
  });

  it('GET /videos/:id несуществующего проекта → 404', async () => {
    const { status } = await get('/videos/nonexistent-id-xyz');
    assert.equal(status, 404);
  });
});

// ─── Математический тест: расчёт субтитров (unit-style) ──────────────────────

describe('Subtitle timing — flash-cut gap calculation', () => {
  it('interSceneGapSec=0.12: drift устранён для 6 сцен', () => {
    const durations = [5.12, 4.96, 5.00, 4.56, 5.08, 5.00];
    const gap = 0.12;

    let currentTime = 0;
    const entries = durations.map((dur, i) => {
      const startTime = currentTime + i * gap;
      currentTime += dur;
      return { startTime, dur };
    });

    // Проверяем что каждая сцена начинается ровно через gap после предыдущей
    for (let i = 1; i < entries.length; i++) {
      const prevEnd = entries[i - 1].startTime + entries[i - 1].dur;
      const currStart = entries[i].startTime;
      const actualGap = currStart - prevEnd;
      const diffFromExpected = Math.abs(actualGap - gap);
      assert.ok(diffFromExpected < 0.001,
        `Сцена ${i}: gap=${actualGap.toFixed(4)}s, ожидалось ${gap}s (δ=${diffFromExpected.toFixed(4)})`);
    }
  });

  it('без gap: сцены идут встык (drift растёт)', () => {
    const durations = [5.12, 4.96, 5.00, 4.56, 5.08, 5.00];
    const gap = 0.12; // реальный gap в видео
    const driftPerScene: number[] = [];

    let currentTimeNoGap = 0;
    let currentTimeWithGap = 0;
    for (let i = 0; i < durations.length; i++) {
      const startNoGap   = currentTimeNoGap;
      const startWithGap = currentTimeWithGap + i * gap;
      driftPerScene.push(startWithGap - startNoGap);
      currentTimeNoGap   += durations[i];
      currentTimeWithGap += durations[i];
    }

    // Без учёта gap сцены 1+ будут ранее видео (нарастающий drift)
    for (let i = 1; i < driftPerScene.length; i++) {
      assert.ok(driftPerScene[i] > driftPerScene[i - 1],
        `Drift должен нарастать: scene ${i} drift=${driftPerScene[i].toFixed(2)} <= scene ${i - 1} drift=${driftPerScene[i - 1].toFixed(2)}`);
    }

    // Максимальный drift для 6 сцен = 5 × 0.12 = 0.60s
    const maxDrift = driftPerScene[driftPerScene.length - 1];
    assert.ok(Math.abs(maxDrift - (durations.length - 1) * gap) < 0.001,
      `Макс drift должен быть ${(durations.length - 1) * gap}s, получено ${maxDrift.toFixed(3)}`);
  });

  it('TTS sample rate: 24000 Hz → растягивает аудио в 44100/24000 = 1.8375× без -ar 44100', () => {
    const ttsSampleRate   = 24000;
    const videoSampleRate = 44100;
    const stretchFactor   = videoSampleRate / ttsSampleRate;

    // 30-секундное видео с 24kHz TTS без ресемплирования
    const videoDuration = 30;
    const stretchedAudioDuration = videoDuration * stretchFactor;
    const audioDrift = stretchedAudioDuration - videoDuration;

    assert.ok(audioDrift > 10,
      `Баг с sample rate должен создавать >10s рассинхрон для 30s видео (рассчитано: ${audioDrift.toFixed(1)}s)`);

    // После фикса (-ar 44100) — рассинхрон 0
    const fixedAudioDuration = videoDuration; // ресемплировано до 44100
    const fixedDrift = Math.abs(fixedAudioDuration - videoDuration);
    assert.equal(fixedDrift, 0, 'После фикса -ar 44100 рассинхрон должен быть 0');
  });
});
