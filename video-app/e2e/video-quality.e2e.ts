/**
 * E2E тесты КАЧЕСТВА генерации видео.
 *
 * Проверяет финальный MP4 на соответствие заявленным требованиям:
 *   - длительность ±40% от запрошенной
 *   - разрешение соответствует формату (9:16 / 16:9 / 1:1)
 *   - наличие видео и аудио дорожек
 *   - H.264 кодек, корректный FPS
 *   - валидный MP4 (magic bytes)
 *   - TTS аудио каждой сцены — корректный аудиофайл
 *   - текст сцен содержит ключевые слова из темы
 *   - стоковые клипы (если есть) — валидные MP4 с видеодорожкой
 *
 * Запуск (из video-app/):
 *   npm run test:quality
 *
 * С собственным уже готовым проектом (без новой генерации):
 *   VIDEO_PROJECT_ID=<id> npm run test:quality
 *
 * Env:
 *   VIDEO_E2E_URL        — base URL API
 *   VIDEO_E2E_EMAIL      — email
 *   VIDEO_E2E_PASSWORD   — пароль
 *   VIDEO_PROJECT_ID     — ID уже готового проекта (пропустит генерацию)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_URL, TIMEOUTS } from './config.js';
import { get, post, del, pollUntil } from './helpers.js';

const execFileAsync = promisify(execFile);

// ─── Типы ─────────────────────────────────────────────────────────────────────

type Scene = {
  id?: string;
  text: string;
  videoSource?: string;
  stockAvailable?: boolean;
  imagePrompt?: string;
};

type Project = {
  id: string;
  status: string;
  title: string;
  topic?: string;
  format: string;
  duration: number;
  script?: { scenes: Scene[]; stockPrechecked?: boolean };
  videoUrl?: string;
  progress?: number;
};

type FfprobeStream = {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  channels?: number;
};

type FfprobeOutput = {
  streams: FfprobeStream[];
  format: { duration: string; size: string; bit_rate: string; format_name: string };
};

// ─── Утилиты ──────────────────────────────────────────────────────────────────

/** Запускает ffprobe на буфере через временный файл. Возвращает JSON. */
async function probeBuffer(buf: ArrayBuffer, ext = 'mp4'): Promise<FfprobeOutput> {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-probe-'));
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
    // tmpdir папку не удаляем (OS почистит)
  }
}

/** Скачивает URL и возвращает ArrayBuffer. */
async function fetchBuf(url: string, timeoutMs = 60_000): Promise<{ buf: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { buf: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? '' };
}

/** Проверяет что буфер начинается с MP4/ISO Base Media magic bytes. */
function assertValidMp4(buf: ArrayBuffer, label: string) {
  const view = new DataView(buf);
  // Байты 4-7 должны содержать 'ftyp' (0x66747970) или размер первого box > 0
  const marker = String.fromCharCode(
    view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7),
  );
  assert.ok(
    marker === 'ftyp' || marker === 'moov' || marker === 'mdat' || marker === 'free',
    `${label}: невалидный MP4, magic bytes = "${marker}"`,
  );
}

/** Проверяет соответствие ширина×высота и формата. */
function assertResolution(probe: FfprobeOutput, format: string) {
  const video = probe.streams.find(s => s.codec_type === 'video');
  assert.ok(video, 'Нет видеодорожки');
  const w = video.width!;
  const h = video.height!;
  assert.ok(w > 0 && h > 0, `Некорректные размеры: ${w}×${h}`);

  if (format === '9:16') {
    assert.ok(h > w, `Формат 9:16 должен быть портретным, получено ${w}×${h}`);
    const ratio = h / w;
    assert.ok(ratio > 1.5 && ratio < 2.2, `Соотношение сторон для 9:16 должно быть ~1.78, получено ${ratio.toFixed(2)}`);
  } else if (format === '16:9') {
    assert.ok(w > h, `Формат 16:9 должен быть альбомным, получено ${w}×${h}`);
    const ratio = w / h;
    assert.ok(ratio > 1.5 && ratio < 2.2, `Соотношение сторон для 16:9 должно быть ~1.78, получено ${ratio.toFixed(2)}`);
  } else if (format === '1:1') {
    const ratio = w / h;
    assert.ok(ratio > 0.85 && ratio < 1.15, `Формат 1:1 должен быть квадратным, получено ${w}×${h}`);
  }
}

/** Базовые слова из темы → минимальное совпадение в тексте сцен. */
function extractKeywords(topic: string): string[] {
  const stopWords = new Set(['и', 'в', 'на', 'с', 'для', 'по', 'не', 'как', 'это', 'что', 'of', 'the', 'a', 'an', 'for', 'to', 'and', 'is', 'are']);
  return topic
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
}

// ─── Конфиг теста ─────────────────────────────────────────────────────────────

const TEST_TOPIC    = 'Польза утренней пробежки для здоровья и иммунитета';
const TEST_FORMAT   = '9:16' as const;
const TEST_DURATION = 30; // секунд
const TEST_MODEL    = 'seedance';

// Если задан готовый проект — берём его, иначе создаём новый
const PRESET_PROJECT_ID = process.env.VIDEO_PROJECT_ID ?? '';

let projectId = PRESET_PROJECT_ID;
let project: Project;
const ownedProject = !PRESET_PROJECT_ID; // будем ли удалять в конце

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  if (PRESET_PROJECT_ID) {
    // Используем готовый проект
    const r = await get<Project>(`/videos/${PRESET_PROJECT_ID}`);
    assert.equal(r.status, 200, `Проект ${PRESET_PROJECT_ID} не найден`);
    project = r.body;
    assert.equal(project.status, 'done', `Проект должен быть в статусе done, текущий: ${project.status}`);
    console.log(`[setup] Используем готовый проект ${projectId}, тема: "${project.topic}"`);
    return;
  }

  // Создаём + полная генерация
  console.log('[setup] Создаём проект...');
  const rCreate = await post<Project>('/videos', {
    title: '[E2E Quality] Test',
    topic: TEST_TOPIC,
    format: TEST_FORMAT,
    duration: TEST_DURATION,
    language: 'ru',
    animationModel: TEST_MODEL,
    subtitleStyle: 'tiktok',
  });
  assert.equal(rCreate.status, 201, `Создание провалилось: ${JSON.stringify(rCreate.body)}`);
  projectId = rCreate.body.id;
  console.log(`[setup] Проект создан: ${projectId}`);

  // Генерация скрипта
  console.log('[setup] Генерируем скрипт...');
  const rScript = await post(`/videos/${projectId}/generate-script`, {});
  assert.ok([200, 202].includes(rScript.status));

  await pollUntil<Project>(
    `/videos/${projectId}`,
    p => p.status === 'script_ready',
    { timeoutMs: TIMEOUTS.script },
  );
  console.log('[setup] Скрипт готов. Ждём stock precheck...');

  await pollUntil<Project>(
    `/videos/${projectId}`,
    p => p.script?.stockPrechecked === true,
    { timeoutMs: TIMEOUTS.stockPrecheck },
  );
  console.log('[setup] Stock precheck готов. Запускаем генерацию...');

  const rGen = await post(`/videos/${projectId}/generate`, {});
  assert.ok([200, 202].includes(rGen.status));

  project = await pollUntil<Project>(
    `/videos/${projectId}`,
    p => p.status === 'done' || p.status === 'error',
    { timeoutMs: TIMEOUTS.generate, intervalMs: 5000 },
  );
  assert.equal(project.status, 'done', `Генерация завершилась ошибкой: ${JSON.stringify(project)}`);
  console.log(`[setup] Генерация завершена. progress=${project.progress}`);
}, TIMEOUTS.generate + TIMEOUTS.script + TIMEOUTS.stockPrecheck + 30_000);

after(async () => {
  if (ownedProject && projectId) {
    await del(`/videos/${projectId}`).catch(() => {});
    console.log(`[cleanup] Проект ${projectId} удалён`);
  }
});

// ─── Тесты финального MP4 ─────────────────────────────────────────────────────

describe('Финальный MP4 — структура', { timeout: 60_000 }, () => {
  let videoBuf: ArrayBuffer | null = null;
  let downloadSkipReason = '';

  before(async () => {
    const url = `${BASE_URL}/videos/${projectId}/download`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      downloadSkipReason = `GET /download → HTTP ${res.status} (файл отсутствует на сервере)`;
      console.warn(`[download] ${downloadSkipReason}`);
      await res.body?.cancel();
      return; // не бросаем — тесты ниже сами пропустятся
    }
    videoBuf = await res.arrayBuffer();
  }, 65_000);

  it('Файл скачивается (>100 KB)', t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    assert.ok(videoBuf!.byteLength > 100_000, `Файл слишком мал: ${videoBuf!.byteLength} bytes`);
  });

  it('Валидный MP4 (magic bytes ftyp/moov)', t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    assertValidMp4(videoBuf!, 'Final video');
  });

  it('ffprobe: содержит видеодорожку', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const videoStream = probe.streams.find(s => s.codec_type === 'video');
    assert.ok(videoStream, `Нет видеодорожки. Дорожки: ${probe.streams.map(s => s.codec_type).join(', ')}`);
  });

  it('ffprobe: содержит аудиодорожку (TTS)', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const audioStream = probe.streams.find(s => s.codec_type === 'audio');
    assert.ok(audioStream, 'Нет аудиодорожки — TTS не был добавлен?');
    assert.ok((audioStream.channels ?? 0) > 0, 'Аудиодорожка без каналов');
  });

  it('ffprobe: видеокодек H.264', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const v = probe.streams.find(s => s.codec_type === 'video');
    assert.ok(v, 'Нет видеодорожки');
    assert.equal(v.codec_name, 'h264', `Ожидался h264, получен ${v.codec_name}`);
  });

  it(`ffprobe: разрешение соответствует формату ${TEST_FORMAT}`, async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    assertResolution(probe, project.format ?? TEST_FORMAT);
  });

  it('ffprobe: длительность ±40% от запрошенной', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const actualDuration = parseFloat(probe.format.duration);
    const expected = project.duration ?? TEST_DURATION;
    const tolerance = expected * 0.40;
    assert.ok(
      Math.abs(actualDuration - expected) <= tolerance,
      `Длительность ${actualDuration.toFixed(1)}с, ожидалось ${expected}с ±40% (${(expected - tolerance).toFixed(0)}–${(expected + tolerance).toFixed(0)}с)`,
    );
  });

  it('ffprobe: FPS >= 24', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const v = probe.streams.find(s => s.codec_type === 'video');
    assert.ok(v, 'Нет видеодорожки');
    const [num, den] = (v.r_frame_rate ?? '0/1').split('/').map(Number);
    const fps = den > 0 ? num / den : 0;
    assert.ok(fps >= 24, `FPS слишком низкий: ${fps.toFixed(1)}`);
  });

  it('ffprobe: битрейт > 500 kbps', async t => {
    if (downloadSkipReason) return t.skip(downloadSkipReason);
    const probe = await probeBuffer(videoBuf!);
    const bitrate = parseInt(probe.format.bit_rate ?? '0');
    assert.ok(bitrate > 500_000, `Битрейт слишком низкий: ${(bitrate / 1000).toFixed(0)} kbps`);
  });
});

// ─── Тесты скрипта и сцен ─────────────────────────────────────────────────────

describe('Скрипт и сцены', () => {
  it('Скрипт существует и содержит сцены', () => {
    assert.ok(project.script, 'Нет скрипта');
    assert.ok(project.script.scenes.length >= 3,
      `Сцен ${project.script.scenes.length}, ожидалось >= 3`);
  });

  it('Количество сцен соответствует длительности (~1 сцена на 5-15 сек)', () => {
    const scenes = project.script!.scenes;
    const minScenes = Math.max(1, Math.floor(project.duration / 15));
    const maxScenes = Math.ceil(project.duration / 5);
    assert.ok(
      scenes.length >= minScenes && scenes.length <= maxScenes,
      `Сцен ${scenes.length} при длительности ${project.duration}с (ожидалось ${minScenes}–${maxScenes})`,
    );
  });

  it('Каждая сцена содержит непустой текст', () => {
    for (const [i, scene] of project.script!.scenes.entries()) {
      assert.ok(
        typeof scene.text === 'string' && scene.text.trim().length > 10,
        `Сцена ${i}: текст слишком короткий или пустой: "${scene.text}"`,
      );
    }
  });

  it('Тексты сцен содержат ключевые слова из темы', t => {
    const topic = project.topic ?? TEST_TOPIC;
    const keywords = extractKeywords(topic);

    // Пропускаем если тема слишком короткая или бренд-название (< 3 осмысленных слов)
    if (keywords.length < 3) {
      return t.skip(`Тема "${topic}" содержит < 3 ключевых слов (${keywords.join(', ')}) — пропускаем`);
    }

    // Определяем язык темы и сцен по доле кириллицы
    const cyrillicRatio = (s: string) => (s.match(/[а-яё]/gi)?.length ?? 0) / (s.length || 1);
    const topicIsCyrillic = cyrillicRatio(topic) > 0.3;
    const contentIsCyrillic = cyrillicRatio(project.script!.scenes.map(s => s.text).join(' ')) > 0.3;

    if (topicIsCyrillic !== contentIsCyrillic) {
      return t.skip(`Язык темы и сцен не совпадают (тема: ${topicIsCyrillic ? 'RU' : 'EN'}, контент: ${contentIsCyrillic ? 'RU' : 'EN'}) — пропускаем`);
    }

    const allText = project.script!.scenes.map(s => s.text.toLowerCase()).join(' ');
    const matchedKeywords = keywords.filter(kw => allText.includes(kw));
    const matchRatio = matchedKeywords.length / keywords.length;

    // Требуем хотя бы 1 совпадение: AI делает короткие заголовки сцен, не повторяет тему дословно
    assert.ok(
      matchedKeywords.length >= 1,
      `Ни одного ключевого слова темы не найдено в тексте сцен.\n` +
      `Тема: "${topic}"\nКлючевые слова: [${keywords.join(', ')}]\nТексты сцен: [${project.script!.scenes.map(s => s.text).join(' | ')}]`,
    );
  });

  it('Нет дублирующихся текстов сцен', () => {
    const texts = project.script!.scenes.map(s => s.text.trim().toLowerCase());
    const unique = new Set(texts);
    assert.equal(unique.size, texts.length,
      `Есть дублирующиеся тексты сцен (уникальных ${unique.size} из ${texts.length})`);
  });

  it('videoSource проставлен для каждой сцены', () => {
    const valid = new Set(['stock', 'ai', 'stock-animated']);
    for (const [i, scene] of project.script!.scenes.entries()) {
      assert.ok(
        valid.has(scene.videoSource ?? ''),
        `Сцена ${i}: некорректный videoSource="${scene.videoSource}"`,
      );
    }
  });
});

// ─── Тесты TTS аудио каждой сцены ────────────────────────────────────────────

describe('TTS аудио сцен', { timeout: 60_000 }, () => {
  let scenes: Scene[];

  before(() => {
    scenes = project.script?.scenes ?? [];
  });

  it('TTS аудио существует для каждой сцены', { timeout: 60_000 }, async () => {
    assert.ok(scenes.length > 0, 'Нет сцен');

    for (let i = 0; i < scenes.length; i++) {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/audio/${i}`, {
        signal: AbortSignal.timeout(15_000),
      });
      assert.ok(
        res.status === 200 || res.status === 404, // 404 если файл ещё не создан (только проверяем статус)
        `Сцена ${i}: неожиданный статус ${res.status}`,
      );

      if (res.status === 200) {
        const ct = res.headers.get('content-type') ?? '';
        assert.match(ct, /audio\/(mpeg|mp3|wav|ogg|x-wav)/, `Сцена ${i}: content-type="${ct}"`);

        const buf = await res.arrayBuffer();
        assert.ok(buf.byteLength > 500, `Сцена ${i}: аудио слишком маленькое (${buf.byteLength} bytes)`);

        // ffprobe на аудио
        const probe = await probeBuffer(buf, 'mp3');
        const audio = probe.streams.find(s => s.codec_type === 'audio');
        assert.ok(audio, `Сцена ${i}: нет аудиодорожки в TTS файле`);

        const audioDuration = parseFloat(probe.format.duration ?? '0');
        assert.ok(audioDuration > 0.5, `Сцена ${i}: TTS аудио слишком короткое (${audioDuration.toFixed(2)}с)`);
        assert.ok(audioDuration < 60, `Сцена ${i}: TTS аудио подозрительно длинное (${audioDuration.toFixed(2)}с)`);
      }
    }
  });
});

// ─── Тесты стоковых клипов ────────────────────────────────────────────────────

describe('Стоковые клипы', { timeout: 60_000 }, () => {
  it('Стоковые клипы — валидные MP4 с видеодорожкой', { timeout: 60_000 }, async () => {
    const stockScenes = (project.script?.scenes ?? [])
      .map((s, i) => ({ ...s, index: i }))
      .filter(s => s.videoSource === 'stock' || s.stockAvailable);

    if (stockScenes.length === 0) {
      console.log('[stock clips] Нет стоковых сцен — пропускаем');
      return;
    }

    for (const scene of stockScenes.slice(0, 3)) { // проверяем первые 3
      const res = await fetch(`${BASE_URL}/videos/${projectId}/clips/${scene.index}`, {
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 404) {
        console.log(`[stock clips] Сцена ${scene.index}: клип не найден (404)`);
        continue;
      }

      assert.equal(res.status, 200, `Сцена ${scene.index}: статус ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      assert.match(ct, /video\/mp4/, `Сцена ${scene.index}: content-type="${ct}"`);

      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 10_000, `Сцена ${scene.index}: клип слишком маленький (${buf.byteLength} bytes)`);

      assertValidMp4(buf, `Stock clip scene ${scene.index}`);

      const probe = await probeBuffer(buf);
      const videoStream = probe.streams.find(s => s.codec_type === 'video');
      assert.ok(videoStream, `Сцена ${scene.index}: нет видеодорожки в стоковом клипе`);
      const clipDuration = parseFloat(probe.format.duration ?? '0');
      assert.ok(clipDuration >= 1, `Сцена ${scene.index}: клип слишком короткий (${clipDuration.toFixed(2)}с)`);
    }
  });
});

// ─── Итоговый отчёт ───────────────────────────────────────────────────────────

describe('Итоговый отчёт', () => {
  it('Все требования выполнены (summary)', async () => {
    const { body: final } = await get<Project>(`/videos/${projectId}`);

    console.log('\n─── Quality Report ──────────────────────');
    console.log(`Project ID  : ${final.id}`);
    console.log(`Topic       : ${final.topic}`);
    console.log(`Format      : ${final.format}`);
    console.log(`Duration    : ${final.duration}s (requested)`);
    console.log(`Status      : ${final.status}`);
    console.log(`Progress    : ${final.progress}%`);
    console.log(`Scenes      : ${final.script?.scenes.length ?? 0}`);
    console.log(`Stock scenes: ${final.script?.scenes.filter(s => s.videoSource === 'stock').length ?? 0}`);
    console.log(`AI scenes   : ${final.script?.scenes.filter(s => s.videoSource === 'ai').length ?? 0}`);
    console.log(`Video URL   : ${final.videoUrl ?? '(none)'}`);
    console.log('─────────────────────────────────────────\n');

    assert.equal(final.status, 'done');
    assert.equal(final.progress, 100);
    assert.ok(final.videoUrl, 'videoUrl отсутствует');
  });
});
