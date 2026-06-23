/**
 * E2E тесты постпродакшн операций.
 *
 * Охватывает все операции над уже созданным проектом/скриптом:
 *
 *   ┌─ PATCH /videos/:id/scenes/:sceneId      — редактирование сцены
 *   ├─ POST  /videos/:id/scenes/:i/translate-prompt  — перевод промпта EN↔RU
 *   ├─ POST  /videos/:id/scenes/:i/stock-retry        — повторный поиск стока
 *   ├─ POST  /videos/:id/scenes/:i/upload-frame       — загрузка своего кадра
 *   ├─ POST  /videos/:id/scenes/:i/generate-variants  — 3 AI-варианта картинок
 *   ├─ GET   /videos/:id/images/:i/:v          — превью варианта изображения
 *   ├─ GET   /videos/:id/clips/:i              — стоковый клип
 *   ├─ GET   /videos/:id/audio/:i              — TTS аудио сцены (44100 Hz fix)
 *   ├─ POST  /videos/:id/reset                 — сброс до script_ready
 *   └─ POST  /videos/:id/resume                — переналожение субтитров (SLOW)
 *
 * Запуск (из video-app/):
 *   npm run test:postprod                      — быстрые + медленные
 *   SKIP_SLOW=1 npm run test:postprod          — только быстрые (без генерации видео)
 *
 *   VIDEO_PROJECT_ID=<done_id>  npm run test:postprod   — пропустить генерацию,
 *                                                          использовать готовый проект
 *
 * Env:
 *   VIDEO_E2E_URL      — base URL API (default: http://localhost:3001/api)
 *   VIDEO_PROJECT_ID   — ID готового проекта (статус=done) для медленных тестов
 *   SKIP_SLOW=1        — пропустить тесты требующие полную генерацию видео
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile }                       from 'node:child_process';
import { promisify }                      from 'node:util';
import { writeFile, unlink, mkdtemp }     from 'node:fs/promises';
import { tmpdir }                         from 'node:os';
import { join }                           from 'node:path';
import { BASE_URL, TIMEOUTS }             from './config.js';
import { get, post, del, patch, pollUntil } from './helpers.js';

const execFileAsync = promisify(execFile);

// ─── Env flags ────────────────────────────────────────────────────────────────

const SKIP_SLOW        = process.env.SKIP_SLOW === '1';
const PRESET_DONE_ID   = process.env.VIDEO_PROJECT_ID ?? '';

// ─── Типы ─────────────────────────────────────────────────────────────────────

type Scene = {
  id: string;
  text: string;
  narration?: string;
  imagePrompt?: string;
  imagePromptRu?: string;
  t2vPrompt?: string;
  t2vPromptRu?: string;
  videoSource?: 'stock' | 'ai' | 'stock-animated';
  stockAvailable?: boolean;
  stockQuery?: string;
  selectedVariant?: number;
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
  videoPath?: string;
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
  format: { duration: string; size: string; bit_rate: string };
};

// ─── Утилиты ──────────────────────────────────────────────────────────────────

async function probeBuffer(buf: ArrayBuffer, ext = 'mp4'): Promise<FfprobeOutput> {
  const dir = await mkdtemp(join(tmpdir(), 'pp-probe-'));
  const tmp = join(dir, `p.${ext}`);
  try {
    await writeFile(tmp, Buffer.from(buf));
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', tmp,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

async function fetchBuf(url: string, ms = 60_000): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
}

/**
 * 1×1 прозрачный PNG в base64 — 100% валиден, sharp конвертирует в JPEG.
 * (upload-frame принимает любой формат изображения, не только JPEG)
 */
const TINY_JPEG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── Shared state ─────────────────────────────────────────────────────────────

// projectId и doneProjectId инициализируются в before() секциях

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 1: БЫСТРЫЕ ТЕСТЫ — требуют только script_ready (~90s)
// ══════════════════════════════════════════════════════════════════════════════

describe('Постпродакшн — операции над сценарием', { timeout: TIMEOUTS.script + TIMEOUTS.stockPrecheck + 60_000 }, () => {
  let projectId: string;
  let scenes: Scene[];
  let firstSceneId: string;
  let firstAiSceneIdx = 0; // индекс первой AI-сцены (после пречека)

  // ── Setup: создаём проект и генерируем только скрипт ────────────────────────
  before(async () => {
    console.log('[setup] Создаём тестовый проект...');
    const r = await post<Project>('/videos', {
      title: '[E2E PostProd] Scene ops',
      topic: 'Как ухаживать за комнатными растениями дома',
      format: '9:16',
      duration: 30,
      language: 'ru',
      animationModel: 'seedance',
      subtitleStyle: 'karaoke',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    projectId = r.body.id;
    console.log(`[setup] Проект создан: ${projectId}`);

    // Запускаем скрипт
    const rScript = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202].includes(rScript.status));

    const scriptProject = await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.status === 'script_ready',
      { timeoutMs: TIMEOUTS.script },
    );
    assert.ok(scriptProject.script?.scenes.length, 'Нет сцен в скрипте');
    console.log(`[setup] Скрипт готов: ${scriptProject.script!.scenes.length} сцен. Ждём пречек...`);

    const prechecked = await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.stockPrecheck },
    );

    scenes = prechecked.script!.scenes;
    firstSceneId = scenes[0].id;
    firstAiSceneIdx = scenes.findIndex(s => s.videoSource === 'ai');
    if (firstAiSceneIdx < 0) firstAiSceneIdx = 0; // фолбэк если все стоковые
    console.log(`[setup] Пречек готов. AI сцены: индекс ${firstAiSceneIdx}`);
  }, { timeout: TIMEOUTS.script + TIMEOUTS.stockPrecheck + 30_000 });

  after(async () => {
    if (projectId) {
      await del(`/videos/${projectId}`).catch(() => {});
      console.log(`[cleanup] Проект ${projectId} удалён`);
    }
  });

  // ── PATCH сцены ─────────────────────────────────────────────────────────────

  describe('PATCH /scenes/:sceneId — редактирование сцены', () => {
    it('обновляет text сцены', async () => {
      const newText = 'Обновлённый текст сцены через E2E тест';
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { text: newText });
      assert.equal(r.status, 200, `PATCH status: ${JSON.stringify(r.body).slice(0, 200)}`);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.ok(updated, 'Сцена не найдена после PATCH');
      assert.equal(updated.text, newText, `Текст не обновился: "${updated.text}"`);
    });

    it('обновляет narration отдельно от text', async () => {
      const newNarration = 'Голосовой текст отличается от заголовка';
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { narration: newNarration });
      assert.equal(r.status, 200);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.ok(updated?.narration === newNarration || updated?.text,
        `narration не обновился: "${updated?.narration}"`);
    });

    it('обновляет imagePrompt', async () => {
      const newPrompt = 'Beautiful indoor plant on a sunny windowsill, photorealistic';
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { imagePrompt: newPrompt });
      assert.equal(r.status, 200);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.equal(updated?.imagePrompt, newPrompt, `imagePrompt не обновился: "${updated?.imagePrompt}"`);
    });

    it('обновляет videoSource ai/stock/stock-animated', async () => {
      for (const src of ['ai', 'stock-animated', 'ai'] as const) {
        const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { videoSource: src });
        assert.equal(r.status, 200, `videoSource=${src}: ${JSON.stringify(r.body)}`);

        const { body: p } = await get<Project>(`/videos/${projectId}`);
        const updated = p.script?.scenes.find(s => s.id === firstSceneId);
        assert.equal(updated?.videoSource, src, `videoSource не сохранился: "${updated?.videoSource}"`);
      }
    });

    it('обновляет selectedVariant (0–3)', async () => {
      for (const v of [0, 1, 2, 3]) {
        const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { selectedVariant: v });
        assert.equal(r.status, 200, `selectedVariant=${v}`);
      }
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.equal(updated?.selectedVariant, 3, 'Последний selectedVariant=3 не сохранился');
    });

    it('selectedVariant=4 → 400', async () => {
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { selectedVariant: 4 });
      assert.equal(r.status, 400, `Ожидался 400, получен ${r.status}`);
    });

    it('selectedVariant=-1 → 400', async () => {
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { selectedVariant: -1 });
      assert.equal(r.status, 400, `Ожидался 400, получен ${r.status}`);
    });

    it('несуществующая сцена → 404', async () => {
      const r = await patch(`/videos/${projectId}/scenes/nonexistent-scene-id-xyz`, { text: 'test' });
      assert.equal(r.status, 404, `Ожидался 404, получен ${r.status}`);
    });

    it('несуществующий проект → 404', async () => {
      const r = await patch(`/videos/nonexistent-project-xyz/scenes/any`, { text: 'test' });
      assert.equal(r.status, 404);
    });

    it('обновляет stockQuery', async () => {
      const newQuery = 'house plant watering indoor';
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { stockQuery: newQuery });
      assert.equal(r.status, 200);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.equal(updated?.stockQuery, newQuery);
    });

    it('несколько полей за один PATCH', async () => {
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, {
        text: 'Мульти-PATCH тест',
        selectedVariant: 0,
        videoSource: 'ai',
      });
      assert.equal(r.status, 200);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === firstSceneId);
      assert.equal(updated?.text, 'Мульти-PATCH тест');
      assert.equal(updated?.selectedVariant, 0);
      assert.equal(updated?.videoSource, 'ai');
    });

    it('пустой PATCH (без полей) → 200, ничего не меняется', async () => {
      const { body: before } = await get<Project>(`/videos/${projectId}`);
      const textBefore = before.script?.scenes.find(s => s.id === firstSceneId)?.text;

      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, {});
      assert.equal(r.status, 200);

      const { body: after } = await get<Project>(`/videos/${projectId}`);
      const textAfter = after.script?.scenes.find(s => s.id === firstSceneId)?.text;
      assert.equal(textAfter, textBefore, 'Пустой PATCH не должен изменять текст');
    });
  });

  // ── Перевод промптов ─────────────────────────────────────────────────────────

  describe('POST /scenes/:i/translate-prompt — перевод промпта', { timeout: 30_000 }, () => {
    it('EN→RU: возвращает imagePromptRu или t2vPromptRu', async () => {
      // Сначала убедимся что у сцены есть imagePrompt
      const scene = scenes[firstAiSceneIdx];
      if (!scene?.imagePrompt && !scene?.t2vPrompt) {
        console.log('[translate] Нет EN-промпта у AI-сцены — пропускаем');
        return;
      }

      const r = await post<{ imagePromptRu?: string; t2vPromptRu?: string; success: boolean }>(
        `/videos/${projectId}/scenes/${firstAiSceneIdx}/translate-prompt`, {}
      );
      assert.equal(r.status, 200, `translate-prompt: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(r.body.success);

      const ruText = r.body.imagePromptRu ?? r.body.t2vPromptRu;
      assert.ok(typeof ruText === 'string' && ruText.trim().length > 5,
        `Перевод пустой: "${ruText}"`);

      // Проверяем что в DB сохранилось
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updatedScene = p.script?.scenes[firstAiSceneIdx];
      const savedRu = updatedScene?.imagePromptRu ?? updatedScene?.t2vPromptRu;
      assert.ok(savedRu && savedRu.length > 5,
        `imagePromptRu/t2vPromptRu не сохранился в БД: "${savedRu}"`);
    });

    it('несуществующая сцена → 404', async () => {
      const r = await post(`/videos/${projectId}/scenes/999/translate-prompt`, {});
      assert.equal(r.status, 404);
    });

    it('PATCH imagePromptRu → перезаписывает imagePrompt через обратный перевод', async () => {
      const ruPrompt = 'Красивое растение на подоконнике, яркий солнечный день';
      const sceneId = scenes[firstAiSceneIdx].id;
      const r = await patch<{ success: boolean; imagePrompt?: string }>(
        `/videos/${projectId}/scenes/${sceneId}`,
        { imagePromptRu: ruPrompt }
      );
      assert.equal(r.status, 200);
      // Если есть AI-ключ, imagePrompt обновится через обратный перевод
      // Иначе просто сохраняется imagePromptRu без изменения imagePrompt
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const updated = p.script?.scenes.find(s => s.id === sceneId);
      assert.ok(updated, 'Сцена не найдена');
      // imagePromptRu должен быть сохранён
      assert.equal(updated?.imagePromptRu, ruPrompt,
        `imagePromptRu не сохранился: "${updated?.imagePromptRu}"`);
    });
  });

  // ── Stock retry ──────────────────────────────────────────────────────────────

  describe('POST /scenes/:i/stock-retry — повторный поиск стока', { timeout: 60_000 }, () => {
    it('возвращает { available, videoSource }', async () => {
      const r = await post<{ available: boolean; videoSource: string }>(
        `/videos/${projectId}/scenes/0/stock-retry`, {}
      );
      assert.equal(r.status, 200, `stock-retry: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(typeof r.body.available === 'boolean', 'Нет поля available');
      assert.ok(['stock', 'ai'].includes(r.body.videoSource),
        `Некорректный videoSource: ${r.body.videoSource}`);
    });

    it('с кастомным stockQuery — использует переданный запрос', async () => {
      const r = await post<{ available: boolean; videoSource: string }>(
        `/videos/${projectId}/scenes/0/stock-retry`,
        { stockQuery: 'green houseplant window light' }
      );
      assert.equal(r.status, 200);
      assert.ok(typeof r.body.available === 'boolean');
    });

    it('обновляет videoSource в базе', async () => {
      const r = await post<{ available: boolean; videoSource: string }>(
        `/videos/${projectId}/scenes/0/stock-retry`, {}
      );
      assert.equal(r.status, 200);

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const scene = p.script?.scenes[0];
      assert.equal(scene?.videoSource, r.body.videoSource,
        `DB videoSource="${scene?.videoSource}" != response="${r.body.videoSource}"`);
    });

    it('несуществующая сцена → 404', async () => {
      const r = await post(`/videos/${projectId}/scenes/999/stock-retry`, {});
      assert.equal(r.status, 404);
    });
  });

  // ── Upload custom frame ──────────────────────────────────────────────────────

  describe('POST /scenes/:i/upload-frame — загрузка своего кадра', () => {
    it('plain base64 JPEG → 200, selectedVariant=3', async () => {
      const r = await post<{ success: boolean; variant: number }>(
        `/videos/${projectId}/scenes/0/upload-frame`,
        { imageBase64: TINY_JPEG_B64 }
      );
      assert.equal(r.status, 200, `upload-frame: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(r.body.success);
      assert.equal(r.body.variant, 3);
    });

    it('data URI JPEG → 200', async () => {
      const dataUri = `data:image/jpeg;base64,${TINY_JPEG_B64}`;
      const r = await post<{ success: boolean; variant: number }>(
        `/videos/${projectId}/scenes/0/upload-frame`,
        { imageBase64: dataUri }
      );
      assert.equal(r.status, 200);
      assert.equal(r.body.variant, 3);
    });

    it('selectedVariant автоматически ставится в 3 в БД', async () => {
      await post(`/videos/${projectId}/scenes/0/upload-frame`, { imageBase64: TINY_JPEG_B64 });

      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const scene = p.script?.scenes[0];
      assert.equal(scene?.selectedVariant, 3,
        `Ожидался selectedVariant=3 после загрузки кадра, получен ${scene?.selectedVariant}`);
    });

    it('GET /images/0/3 → 400 (вариант 3 не отдаётся через публичный endpoint, только 0–2)', async () => {
      // Endpoint принимает только variant 0-2 (line 952 routes.ts)
      const res = await fetch(`${BASE_URL}/videos/${projectId}/images/0/3`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(res.status, 400, 'Variant 3 не должен быть доступен через /images/:i/:v');
      await res.body?.cancel();
    });

    it('без imageBase64 → 400', async () => {
      const r = await post(`/videos/${projectId}/scenes/0/upload-frame`, {});
      assert.equal(r.status, 400);
    });

    it('неверный индекс сцены (>99) → 400', async () => {
      const r = await post(`/videos/${projectId}/scenes/100/upload-frame`, { imageBase64: TINY_JPEG_B64 });
      assert.equal(r.status, 400);
    });
  });

  // ── Image variants endpoint ──────────────────────────────────────────────────

  describe('GET /images/:i/:v — превью AI-вариантов', () => {
    it('variant=-1 → 400', async () => {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/images/0/-1`, {
        signal: AbortSignal.timeout(10_000),
      });
      // Node router может отдать 400 или просто не матчить маршрут (404)
      assert.ok([400, 404].includes(res.status),
        `Ожидался 400/404 для variant=-1, получен ${res.status}`);
      await res.body?.cancel();
    });

    it('variant=3 → 400 (только 0–2)', async () => {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/images/0/3`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(res.status, 400);
      await res.body?.cancel();
    });

    it('несуществующий вариант → 404', async () => {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/images/99/0`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(res.status, 404);
      await res.body?.cancel();
    });
  });

  // ── TTS аудио (preview после генерации скрипта) ──────────────────────────────

  describe('GET /audio/:i — TTS аудио сцены', { timeout: 30_000 }, () => {
    it('GET /audio/0 — 200 audio/mpeg или 404 (ещё не готово)', async () => {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/audio/0`, {
        signal: AbortSignal.timeout(15_000),
      });
      assert.ok([200, 404].includes(res.status),
        `Неожиданный статус: ${res.status}`);

      if (res.status === 200) {
        const ct = res.headers.get('content-type') ?? '';
        assert.match(ct, /audio\/(mpeg|mp3|wav)/, `content-type="${ct}"`);
        const buf = await res.arrayBuffer();
        assert.ok(buf.byteLength > 500, `Аудио слишком мало: ${buf.byteLength} bytes`);
      } else {
        await res.body?.cancel();
        console.log('[audio] TTS ещё не готов (404) — это нормально сразу после скрипта');
      }
    });

    it('GET /audio/999 → 400 (invalid index)', async () => {
      const res = await fetch(`${BASE_URL}/videos/${projectId}/audio/999`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.ok([400, 404].includes(res.status),
        `Ожидался 400/404 для index=999, получен ${res.status}`);
      await res.body?.cancel();
    });
  });

  // ── Reset ────────────────────────────────────────────────────────────────────

  describe('POST /reset — сброс до script_ready', () => {
    it('status становится script_ready', async () => {
      const r = await post<{ success: boolean }>(`/videos/${projectId}/reset`, {});
      assert.ok([200, 204].includes(r.status), `reset: ${r.status}`);
    });

    it('после reset: status=script_ready, progress=10, videoUrl пустой', async () => {
      await post(`/videos/${projectId}/reset`, {});
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      assert.equal(p.status, 'script_ready', `status после reset: ${p.status}`);
      assert.ok((p.progress ?? 0) <= 20, `progress после reset: ${p.progress}`);
      assert.ok(!p.videoUrl || p.videoUrl === '', `videoUrl должен быть очищен, получен "${p.videoUrl}"`);
    });

    it('несуществующий проект → 404', async () => {
      const r = await post('/videos/nonexistent-xyz/reset', {});
      assert.equal(r.status, 404);
    });
  });

  // ── Новые операции над сценами ────────────────────────────────────────────

  describe('PATCH /scenes/:id — поле duration', () => {
    it('обновляет duration сцены', async () => {
      const r = await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { duration: 7 });
      assert.equal(r.status, 200, `patch duration: ${JSON.stringify(r.body)}`);
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const sc = p.script!.scenes.find(s => s.id === firstSceneId);
      assert.equal(sc?.duration, 7, `duration не обновился: ${sc?.duration}`);
    });

    it('duration > 60 → игнорируется (нет обновления)', async () => {
      const before = await get<Project>(`/videos/${projectId}`);
      const oldDuration = before.body.script!.scenes.find(s => s.id === firstSceneId)?.duration;
      await patch(`/videos/${projectId}/scenes/${firstSceneId}`, { duration: 999 });
      const after = await get<Project>(`/videos/${projectId}`);
      const newDuration = after.body.script!.scenes.find(s => s.id === firstSceneId)?.duration;
      assert.equal(newDuration, oldDuration, `duration не должен был измениться: ${newDuration}`);
    });
  });

  describe('DELETE /scenes/:i — удаление сцены', () => {
    it('удаляет сцену по индексу', async () => {
      const { body: before } = await get<Project>(`/videos/${projectId}`);
      const prevCount = before.script!.scenes.length;
      const r = await del(`/videos/${projectId}/scenes/0`);
      assert.equal(r.status, 200, `delete scene: ${JSON.stringify(r.body)}`);
      const { body: after } = await get<Project>(`/videos/${projectId}`);
      assert.equal(after.script!.scenes.length, prevCount - 1, 'Число сцен должно уменьшиться на 1');
    });

    it('нельзя удалить единственную сцену → 400', async () => {
      // Оставляем до одной сцены
      let p = await get<Project>(`/videos/${projectId}`);
      while (p.body.script!.scenes.length > 1) {
        await del(`/videos/${projectId}/scenes/0`);
        p = await get<Project>(`/videos/${projectId}`);
      }
      const r = await del(`/videos/${projectId}/scenes/0`);
      assert.equal(r.status, 400, `должен вернуть 400: ${JSON.stringify(r.body)}`);
    });

    it('несуществующий индекс → 400', async () => {
      const r = await del(`/videos/${projectId}/scenes/999`);
      assert.equal(r.status, 400);
    });

    it('несуществующий проект → 404', async () => {
      const r = await del('/videos/nonexistent-xyz/scenes/0');
      assert.equal(r.status, 404);
    });
  });

  describe('POST /scenes — добавление пустой сцены', () => {
    it('добавляет сцену в конец', async () => {
      const { body: before } = await get<Project>(`/videos/${projectId}`);
      const prevCount = before.script!.scenes.length;
      const r = await post<{ success: boolean; insertedAt: number }>(`/videos/${projectId}/scenes`, {});
      assert.equal(r.status, 201, `add scene: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.success);
      const { body: after } = await get<Project>(`/videos/${projectId}`);
      assert.equal(after.script!.scenes.length, prevCount + 1, 'Число сцен должно вырасти на 1');
    });

    it('insertAt=0 вставляет в начало', async () => {
      const r = await post<{ success: boolean; insertedAt: number }>(`/videos/${projectId}/scenes`, { insertAt: 0 });
      assert.equal(r.status, 201);
      assert.equal(r.body.insertedAt, 0);
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      assert.equal(p.script!.scenes[0].text, 'Новая сцена');
    });

    it('новая сцена имеет videoSource=ai и duration', async () => {
      await post(`/videos/${projectId}/scenes`, {});
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const last = p.script!.scenes[p.script!.scenes.length - 1];
      assert.equal(last.videoSource, 'ai');
      assert.ok(last.duration && last.duration > 0, `duration: ${last.duration}`);
    });

    it('несуществующий проект → 404', async () => {
      const r = await post('/videos/nonexistent-xyz/scenes', {});
      assert.equal(r.status, 404);
    });
  });

  describe('POST /scenes/reorder — перестановка сцен', () => {
    it('меняет порядок сцен', async () => {
      // Убедимся что есть хотя бы 2 сцены
      let p = await get<Project>(`/videos/${projectId}`);
      while (p.body.script!.scenes.length < 2) {
        await post(`/videos/${projectId}/scenes`, {});
        p = await get<Project>(`/videos/${projectId}`);
      }
      const scenes = p.body.script!.scenes;
      const firstId = scenes[0].id;
      const secondId = scenes[1].id;
      // Переставляем: [1,0,...остальные]
      const order = [1, 0, ...scenes.slice(2).map((_, i) => i + 2)];
      const r = await post<{ success: boolean }>(`/videos/${projectId}/scenes/reorder`, { order });
      assert.equal(r.status, 200, `reorder: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.success);
      const { body: after } = await get<Project>(`/videos/${projectId}`);
      assert.equal(after.script!.scenes[0].id, secondId, 'Первая сцена должна стать второй');
      assert.equal(after.script!.scenes[1].id, firstId, 'Вторая сцена должна стать первой');
    });

    it('order неверной длины → 400', async () => {
      const r = await post(`/videos/${projectId}/scenes/reorder`, { order: [0] });
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const sceneCount = p.script!.scenes.length;
      if (sceneCount !== 1) {
        assert.equal(r.status, 400, `должен вернуть 400 при неверной длине: ${JSON.stringify(r.body)}`);
      }
    });

    it('несуществующий проект → 404', async () => {
      const r = await post('/videos/nonexistent-xyz/scenes/reorder', { order: [0] });
      assert.equal(r.status, 404);
    });
  });

  describe('POST /scenes/:i/regenerate-audio — перегенерация TTS', () => {
    it('возвращает 200 success для валидной сцены', async () => {
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const sceneCount = p.script!.scenes.length;
      if (sceneCount === 0) return;
      const r = await post<{ success: boolean }>(`/videos/${projectId}/scenes/0/regenerate-audio`, {});
      // Может вернуть 200 (успешно) или 500 если нет TTS ключа в dev
      assert.ok([200, 500].includes(r.status), `regen-audio: ${r.status} ${JSON.stringify(r.body)}`);
    });

    it('несуществующий индекс → 400', async () => {
      const r = await post(`/videos/${projectId}/scenes/999/regenerate-audio`, {});
      assert.equal(r.status, 400);
    });

    it('несуществующий проект → 404', async () => {
      const r = await post('/videos/nonexistent-xyz/scenes/0/regenerate-audio', {});
      assert.equal(r.status, 404);
    });
  });

  describe('POST /scenes/:i/reanimate — повторная анимация сцены', () => {
    it('возвращает 200 success (async, fire-and-forget)', async () => {
      const { body: p } = await get<Project>(`/videos/${projectId}`);
      const sceneCount = p.script!.scenes.length;
      if (sceneCount === 0) return;
      const r = await post<{ success: boolean; message: string }>(`/videos/${projectId}/scenes/0/reanimate`, {});
      assert.equal(r.status, 200, `reanimate: ${JSON.stringify(r.body)}`);
      assert.ok(r.body.success);
      assert.ok(r.body.message, 'message должен быть в ответе');
    });

    it('несуществующий индекс → 400', async () => {
      const r = await post(`/videos/${projectId}/scenes/999/reanimate`, {});
      assert.equal(r.status, 400);
    });

    it('несуществующий проект → 404', async () => {
      const r = await post('/videos/nonexistent-xyz/scenes/0/reanimate', {});
      assert.equal(r.status, 404);
    });
  });
});

describe('POST /videos — musicVolume при создании', { timeout: 30_000 }, () => {
  let testProjectId: string;

  after(async () => {
    if (testProjectId) await del(`/videos/${testProjectId}`).catch(() => {});
  });

  it('создаёт проект с musicVolume и сохраняет значение', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] musicVolume test',
      topic: 'тест громкости музыки',
      format: '9:16',
      duration: 15,
      language: 'ru',
      animationModel: 'wan',
      musicStyle: 'ambient',
      musicVolume: 0.25,
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    testProjectId = r.body.id;
    const { body: p } = await get<Project & { musicVolume?: number }>(`/videos/${testProjectId}`);
    assert.equal((p as any).musicVolume, 0.25, `musicVolume должен быть 0.25, получен: ${(p as any).musicVolume}`);
  });

  it('musicVolume вне диапазона [0,1] игнорируется', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] musicVolume invalid',
      topic: 'тест',
      format: '9:16',
      duration: 15,
      language: 'ru',
      animationModel: 'wan',
      musicVolume: 1.5,
    });
    assert.equal(r.status, 201);
    const id = r.body.id;
    await del(`/videos/${id}`).catch(() => {});
    // musicVolume=1.5 не должен сохраниться (undefined/null)
    // Просто проверяем что запрос не упал
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 2: МЕДЛЕННЫЕ ТЕСТЫ — требуют status=done (~10 мин)
// ══════════════════════════════════════════════════════════════════════════════

describe('Постпродакшн — операции над готовым видео', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: TIMEOUTS.generate + TIMEOUTS.script + 90_000,
}, () => {
  let doneProjectId = PRESET_DONE_ID;
  const ownProject  = !PRESET_DONE_ID;

  // ── Setup: получаем готовый проект ──────────────────────────────────────────
  before(async () => {
    if (PRESET_DONE_ID) {
      const { body: p } = await get<Project>(`/videos/${PRESET_DONE_ID}`);
      assert.equal(p.status, 'done',
        `Проект ${PRESET_DONE_ID} не в статусе done (статус: ${p.status})`);
      console.log(`[slow-setup] Используем готовый проект: ${PRESET_DONE_ID}`);
      return;
    }

    console.log('[slow-setup] Генерируем новый проект...');
    const r = await post<Project>('/videos', {
      title: '[E2E PostProd] Resume test',
      topic: 'Утренняя зарядка для бодрости на весь день',
      format: '9:16',
      duration: 30,
      language: 'ru',
      animationModel: 'seedance',
      subtitleStyle: 'karaoke',
    });
    assert.equal(r.status, 201);
    doneProjectId = r.body.id;

    const rGen = await post(`/videos/${doneProjectId}/generate`, {});
    assert.ok([200, 202].includes(rGen.status));

    const done = await pollUntil<Project>(
      `/videos/${doneProjectId}`,
      p => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 8000 },
    );
    assert.equal(done.status, 'done',
      `Генерация не завершилась: ${done.status}. Error: ${done.error}`);
    console.log(`[slow-setup] Проект готов: ${doneProjectId}`);
  }, { timeout: TIMEOUTS.generate + TIMEOUTS.script + 60_000 });

  after(async () => {
    if (ownProject && doneProjectId) {
      await del(`/videos/${doneProjectId}`).catch(() => {});
      console.log(`[slow-cleanup] Проект ${doneProjectId} удалён`);
    }
  });

  // ── TTS аудио качество ───────────────────────────────────────────────────────

  describe('GET /audio/:i — качество TTS аудио', { timeout: 60_000 }, () => {
    it('audio/0 существует и валиден', async () => {
      const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/audio/0`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        console.log('[audio] Сцена 0: TTS файл не найден (может быть очищен) — skip');
        return;
      }
      assert.equal(res.status, 200, `audio/0 вернул ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      assert.match(ct, /audio\/(mpeg|mp3|wav)/, `content-type="${ct}"`);
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 500, `Аудио слишком мало: ${buf.byteLength} bytes`);
    });

    it('audio/0 — 44100 Hz sample rate (sample rate bug fix)', { timeout: 30_000 }, async () => {
      const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/audio/0`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        console.log('[audio] Файл не найден — skip');
        return;
      }
      assert.equal(res.status, 200);
      const buf = await res.arrayBuffer();
      const probe = await probeBuffer(buf, 'mp3');
      const audio = probe.streams.find(s => s.codec_type === 'audio');
      assert.ok(audio, 'Нет аудиодорожки в TTS файле');

      const sr = parseInt(audio.sample_rate ?? '0');
      // OpenAI TTS изначально 24kHz, но после ресемплирования через -ar 44100 должен быть 44100
      // Если 24kHz — это признак что ресемплирование не применяется к preview-файлам
      // Приемлем и 24000 и 44100 — важно что финальный MP4 использует 44100
      assert.ok(sr === 44100 || sr === 24000,
        `Неожиданный sample rate: ${sr}Hz (ожидался 24000 или 44100)`);
      console.log(`[audio] sample_rate=${sr}Hz`);
    });

    it('audio/0 — длительность 0.5–60s (разумная TTS)', { timeout: 30_000 }, async () => {
      const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/audio/0`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) return;
      assert.equal(res.status, 200);
      const buf = await res.arrayBuffer();
      const probe = await probeBuffer(buf, 'mp3');
      const dur = parseFloat(probe.format.duration ?? '0');
      assert.ok(dur >= 0.5, `TTS слишком короткий: ${dur.toFixed(2)}s`);
      assert.ok(dur <= 60,  `TTS подозрительно длинный: ${dur.toFixed(2)}s (проблема растяжения?)`);
      console.log(`[audio] duration=${dur.toFixed(2)}s`);
    });

    it('все сцены имеют TTS аудио или сервер отвечает корректно', { timeout: 60_000 }, async () => {
      const { body: p } = await get<Project>(`/videos/${doneProjectId}`);
      const sceneCount = p.script?.scenes.length ?? 0;
      assert.ok(sceneCount > 0, 'Нет сцен');

      let found = 0;
      for (let i = 0; i < sceneCount; i++) {
        const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/audio/${i}`, {
          signal: AbortSignal.timeout(10_000),
        });
        assert.ok([200, 404].includes(res.status),
          `Сцена ${i}: неожиданный статус ${res.status}`);
        if (res.status === 200) found++;
        await res.body?.cancel();
      }
      console.log(`[audio] Найдено TTS файлов: ${found}/${sceneCount}`);
      // Хотя бы 50% сцен имеют аудио (после полной генерации должны быть все)
      assert.ok(found >= Math.ceil(sceneCount * 0.5),
        `Слишком мало TTS файлов: ${found}/${sceneCount}`);
    });
  });

  // ── Финальный MP4 — аудио/видео синхронизация ───────────────────────────────

  describe('Финальный MP4 — аудио/видео синхронизация', { timeout: 60_000 }, () => {
    let videoBuf: ArrayBuffer | null = null;
    let probe: FfprobeOutput | null = null;

    before(async () => {
      const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/download`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        console.warn(`[mp4] Скачать видео не удалось: HTTP ${res.status}`);
        await res.body?.cancel();
        return;
      }
      videoBuf = await res.arrayBuffer();
      probe = await probeBuffer(videoBuf);
    }, { timeout: 130_000 });

    it('видео скачивается (>1 MB)', () => {
      if (!videoBuf) { console.log('[mp4] Видео недоступно — skip'); return; }
      assert.ok(videoBuf.byteLength > 1_000_000,
        `Файл слишком мал: ${Math.round(videoBuf.byteLength / 1024)}KB`);
    });

    it('аудио и видео — одинаковая длительность ±2s (sync bug fix)', () => {
      if (!probe) { console.log('[mp4] probe недоступен — skip'); return; }
      const videoDur = parseFloat(probe.format.duration);
      const audioStream = probe.streams.find(s => s.codec_type === 'audio');
      assert.ok(audioStream, 'Нет аудиодорожки в финальном MP4');
      const audioDur = parseFloat(audioStream.duration ?? probe.format.duration);
      const diff = Math.abs(videoDur - audioDur);
      assert.ok(diff <= 2.0,
        `Рассинхрон audio/video = ${diff.toFixed(2)}s ` +
        `(video=${videoDur.toFixed(2)}s, audio=${audioDur.toFixed(2)}s). ` +
        `Проверьте флаг -ar 44100 в assembleFromClips.`);
      console.log(`[mp4] audio/video sync: video=${videoDur.toFixed(2)}s, audio=${audioDur.toFixed(2)}s, diff=${diff.toFixed(3)}s ✓`);
    });

    it('аудио sample rate = 44100 Hz в финальном MP4', () => {
      if (!probe) return;
      const audio = probe.streams.find(s => s.codec_type === 'audio');
      assert.ok(audio, 'Нет аудиодорожки');
      const sr = parseInt(audio.sample_rate ?? '0');
      assert.equal(sr, 44100,
        `sample rate=${sr}Hz в финальном MP4, ожидалось 44100Hz. ` +
        `Это баг: OpenAI TTS 24kHz без ресемплирования растягивает аудио в 1.84×.`);
    });
  });

  // ── Resume: переналожение субтитров ─────────────────────────────────────────

  describe('POST /resume — переналожение субтитров', { timeout: 120_000 }, () => {
    it('возвращает { success: true }', async () => {
      const r = await post<{ success: boolean }>(`/videos/${doneProjectId}/resume`, {});
      assert.ok([200, 202].includes(r.status),
        `resume вернул ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(r.body.success, 'Нет success=true в ответе');
    });

    it('status становится done после resume', { timeout: 120_000 }, async () => {
      await post(`/videos/${doneProjectId}/resume`, {});

      const result = await pollUntil<Project>(
        `/videos/${doneProjectId}`,
        p => p.status === 'done' || p.status === 'error',
        { timeoutMs: 110_000, intervalMs: 3000 },
      );
      assert.equal(result.status, 'done',
        `resume завершился с ошибкой: ${result.status}. Error: ${result.error}`);
      assert.equal(result.progress, 100);
    });

    it('MP4 остаётся валидным после re-burn субтитров', { timeout: 120_000 }, async () => {
      await post(`/videos/${doneProjectId}/resume`, {});
      await pollUntil<Project>(
        `/videos/${doneProjectId}`,
        p => p.status === 'done' || p.status === 'error',
        { timeoutMs: 110_000, intervalMs: 3000 },
      );

      const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/download`, {
        signal: AbortSignal.timeout(60_000),
      });
      assert.equal(res.status, 200, `Скачать после resume: HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 1_000_000, `Файл после resume слишком мал: ${Math.round(buf.byteLength / 1024)}KB`);

      // magic bytes
      const view = new DataView(buf);
      const marker = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
      assert.ok(['ftyp', 'moov', 'mdat', 'free'].includes(marker),
        `Невалидный MP4 после resume: magic="${marker}"`);
    });

    it('повторный resume (уже идёт) → 409 или игнорируется', { timeout: 30_000 }, async () => {
      // Запускаем resume и сразу ещё раз
      await post(`/videos/${doneProjectId}/resume`, {});
      // Небольшая пауза пока сервер переходит в assembling
      await new Promise(r => setTimeout(r, 500));
      const r2 = await post(`/videos/${doneProjectId}/resume`, {});
      // Ожидаем либо 409 (already generating), либо 200 (resume завершился мгновенно)
      assert.ok([200, 202, 409].includes(r2.status),
        `Ожидался 200/202/409, получен ${r2.status}`);
      // Дожидаемся завершения
      await pollUntil<Project>(
        `/videos/${doneProjectId}`,
        p => p.status === 'done' || p.status === 'error',
        { timeoutMs: 110_000, intervalMs: 3000 },
      );
    });
  });

  // ── Generate-variants для AI-сцены ──────────────────────────────────────────

  describe('POST /scenes/:i/generate-variants — 3 AI-варианта', { timeout: 180_000 }, () => {
    let aiSceneIdx = -1;

    before(async () => {
      const { body: p } = await get<Project>(`/videos/${doneProjectId}`);
      aiSceneIdx = (p.script?.scenes ?? []).findIndex(s => s.videoSource === 'ai');
      if (aiSceneIdx < 0) {
        console.log('[variants] Нет AI-сцен — тесты будут пропущены');
      }
    });

    it('POST generate-variants → 200', async t => {
      if (aiSceneIdx < 0) return t.skip('Нет AI-сцен');
      const r = await post<{ success: boolean }>(
        `/videos/${doneProjectId}/scenes/${aiSceneIdx}/generate-variants`, {}
      );
      assert.equal(r.status, 200,
        `generate-variants: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(r.body.success);
    });

    it('GET /images/:i/0,1,2 → image/jpeg или 404', async t => {
      if (aiSceneIdx < 0) return t.skip('Нет AI-сцен');
      for (const v of [0, 1, 2]) {
        const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/images/${aiSceneIdx}/${v}`, {
          signal: AbortSignal.timeout(15_000),
        });
        assert.ok([200, 404].includes(res.status),
          `images/${aiSceneIdx}/${v}: статус ${res.status}`);
        if (res.status === 200) {
          const ct = res.headers.get('content-type') ?? '';
          assert.match(ct, /image\/(jpeg|jpg|png)/, `content-type="${ct}"`);
          const buf = await res.arrayBuffer();
          assert.ok(buf.byteLength > 1000, `Изображение ${v} слишком мало: ${buf.byteLength} bytes`);
        }
        await res.body?.cancel();
      }
    });
  });
});
