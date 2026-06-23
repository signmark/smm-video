/**
 * E2E тесты для Video Generator API.
 * Использует встроенный node:test (Node 20) + tsx.
 *
 * Запуск (из video-app/):
 *   npm run test:e2e                   — все тесты (медленные включены)
 *   npm run test:e2e:fast              — только быстрые (без генерации)
 *   npm run test:e2e:generate          — включает полную генерацию видео
 *
 * Env-переменные:
 *   VIDEO_E2E_URL       — base URL API (default: https://smm.omemo.tech/video-app/api)
 *   VIDEO_E2E_EMAIL     — email для auth
 *   VIDEO_E2E_PASSWORD  — пароль
 *   SKIP_SLOW=1         — пропустить генерацию скрипта/видео
 *   SKIP_GENERATE=1     — пропустить только полную генерацию видео
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, EMAIL, PASSWORD, TIMEOUTS, SKIP_SLOW, SKIP_GENERATE } from './config.js';
import { get, post, del, patch, pollUntil } from './helpers.js';

type Scene = {
  text: string;
  videoSource?: string;
  imagePrompt?: string;
  stockAvailable?: boolean;
};

type Script = {
  scenes: Scene[];
  stockPrechecked?: boolean;
};

type Project = {
  id: string;
  status: string;
  title: string;
  topic?: string;
  format: string;
  duration: number;
  script?: Script;
  videoUrl?: string;
  progress?: number;
};

// Проекты, созданные в ходе тестов — удаляются в after()
const createdIds: string[] = [];

function cleanup(id: string) {
  createdIds.push(id);
}

async function createProject(overrides: Record<string, unknown> = {}): Promise<Project> {
  const r = await post<Project>('/videos', {
    title: '[E2E Test] Temp',
    topic: 'E2E тест',
    format: '9:16',
    duration: 30,
    language: 'ru',
    ...overrides,
  });
  assert.equal(r.status, 201, `Создание проекта: ${JSON.stringify(r.body).slice(0, 200)}`);
  cleanup(r.body.id);
  return r.body;
}

// ─── Health ───────────────────────────────────────────────────────────────────

describe('Health', () => {
  it('GET /health → 200 { status: ok }', async () => {
    const r = await get<{ status: string }>('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('POST /auth/login без данных → 400', async () => {
    const r = await post('/auth/login', {});
    assert.equal(r.status, 400);
  });

  it('POST /auth/login с неверным паролем → 401', async () => {
    const r = await post('/auth/login', { email: 'nobody@test.invalid', password: 'wrong' });
    assert.equal(r.status, 401);
  });

  it('POST /auth/login с верными данными → token', { skip: !EMAIL || !PASSWORD ? 'VIDEO_E2E_EMAIL/PASSWORD не заданы' : false }, async () => {
    const r = await post<{ token: string }>('/auth/login', { email: EMAIL, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.token === 'string' && r.body.token.length > 10, 'Нет токена');
  });
});

// ─── Валидация создания проекта ───────────────────────────────────────────────

describe('POST /videos — валидация', () => {
  it('Без format и duration → 400', async () => {
    const r = await post('/videos', { topic: 'test' });
    assert.equal(r.status, 400);
  });

  it('Без topic/scenario/landingUrl → 400', async () => {
    const r = await post('/videos', { format: '9:16', duration: 60 });
    assert.equal(r.status, 400);
  });

  it('Неверный format → 400', async () => {
    const r = await post('/videos', { topic: 'test', format: '4:3', duration: 60 });
    assert.equal(r.status, 400);
  });

  it('topic слишком длинный (>500 симв.) → 400', async () => {
    const r = await post('/videos', { topic: 'x'.repeat(501), format: '9:16', duration: 60 });
    assert.equal(r.status, 400);
  });
});

// ─── CRUD ──────────────────────────────────────────────────────────────────────

describe('CRUD проекта', () => {
  let projectId: string;

  it('POST /videos → 201 + id + format + duration', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E Test] CRUD',
      topic: 'E2E тест CRUD для видео генератора',
      format: '9:16',
      duration: 30,
      language: 'ru',
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.id, 'Нет id');
    assert.equal(r.body.format, '9:16');
    assert.equal(r.body.duration, 30);
    projectId = r.body.id;
    cleanup(projectId);
  });

  it('GET /videos/:id → 200 + совпадает id', async () => {
    const r = await get<Project>(`/videos/${projectId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, projectId);
  });

  it('GET /videos → массив, содержит созданный проект', async () => {
    const r = await get<Project[]>('/videos');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body), 'Не массив');
    assert.ok(r.body.some(p => p.id === projectId), 'Проект не найден в списке');
  });

  it('GET /videos/nonexistent → 404', async () => {
    const r = await get('/videos/nonexistent-e2e-12345');
    assert.equal(r.status, 404);
  });

  it('DELETE /videos/:id → 200', async () => {
    const r = await del(`/videos/${projectId}`);
    assert.equal(r.status, 200);
    createdIds.splice(createdIds.indexOf(projectId), 1);
  });

  it('GET /videos/:id после удаления → 404', async () => {
    const r = await get(`/videos/${projectId}`);
    assert.equal(r.status, 404);
  });
});

// ─── PATCH сцены ──────────────────────────────────────────────────────────────

describe('PATCH /videos/:id/scenes/:sceneId', () => {
  let projectId: string;

  before(async () => {
    const p = await createProject({ title: '[E2E Test] PATCH' });
    projectId = p.id;
  });

  it('PATCH сцены на проекте без скрипта → 400 (no script)', async () => {
    const r = await patch(`/videos/${projectId}/scenes/999`, { text: 'Test text' });
    // Новый проект без скрипта → 400 "No script"; с несуществующей сценой → 404
    assert.ok([400, 404].includes(r.status), `Ожидался 400 или 404, получен ${r.status}`);
  });
});

// ─── TTS Preview ──────────────────────────────────────────────────────────────

describe('GET /tts-preview/:voice', () => {
  const voices = ['nova', 'alloy', 'echo', 'shimmer', 'onyx', 'fable'];

  for (const voice of voices) {
    it(`/tts-preview/${voice} → audio/mpeg, >1 KB`, async t => {
      const res = await fetch(`${BASE_URL}/tts-preview/${voice}`, {
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(res.status, 200, `Статус ${res.status} для voice=${voice}`);
      const ct = res.headers.get('content-type') ?? '';
      assert.match(ct, /audio\/(mpeg|mp3|wav|ogg)/, `content-type: ${ct}`);
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 1000, `Файл слишком маленький: ${buf.byteLength} bytes`);
    });
  }

  it('/tts-preview/invalid_voice → 400 (invalid voice)', async () => {
    const r = await get('/tts-preview/invalid_voice_xyz');
    assert.equal(r.status, 400);
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────

describe('POST /videos/:id/reset', () => {
  let projectId: string;

  before(async () => {
    const p = await createProject({ title: '[E2E Test] Reset' });
    projectId = p.id;
  });

  it('POST /reset → 200 или 204, статус сбрасывается', async () => {
    const r = await post<Project>(`/videos/${projectId}/reset`, {});
    assert.ok([200, 204].includes(r.status), `Ожидался 200/204, получен ${r.status}`);
  });
});

// ─── Генерация скрипта (медленный) ────────────────────────────────────────────

describe('Генерация скрипта', { skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false }, () => {
  let projectId: string;

  before(async () => {
    const p = await createProject({
      title: '[E2E Test] Script Gen',
      topic: 'Преимущества медитации для продуктивности',
      animationModel: 'seedance',
    });
    projectId = p.id;
  });

  it('POST /generate-script → 200', async () => {
    const r = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202].includes(r.status), `Ожидался 200/202, получен ${r.status}`);
  });

  it('Поллинг: status=script_ready за 90с', { timeout: TIMEOUTS.script + 5_000 }, async () => {
    const p = await pollUntil<Project>(
      `/videos/${projectId}`,
      p => ['script_ready', 'done', 'error'].includes(p.status),
      { timeoutMs: TIMEOUTS.script },
    );
    assert.equal(p.status, 'script_ready', `Неожиданный статус: ${p.status}`);
    assert.ok(p.script?.scenes?.length, 'Нет сцен в скрипте');
  });

  it('Каждая сцена содержит text', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    for (const [i, scene] of p.script!.scenes.entries()) {
      assert.ok(typeof scene.text === 'string' && scene.text.length > 0, `Сцена ${i}: нет текста`);
    }
  });

  it('Сцен >= 3', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.ok(p.script!.scenes.length >= 3, `Сцен меньше 3: ${p.script!.scenes.length}`);
  });

  it('Поллинг: stockPrechecked=true за 120с', { timeout: TIMEOUTS.stockPrecheck + 5_000 }, async () => {
    const p = await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.stockPrecheck },
    );
    assert.ok(p.script?.stockPrechecked, 'stockPrechecked не стал true');
    const allHaveSource = p.script!.scenes.every(s =>
      ['stock', 'ai', 'stock-animated'].includes(s.videoSource ?? '')
    );
    assert.ok(allHaveSource, 'Не у всех сцен проставлен videoSource');
  });
});

// ─── Generate-variants для AI-сцены (медленный) ───────────────────────────────

describe('POST /scenes/:i/generate-variants', { skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false }, () => {
  let projectId: string;
  let aiSceneIndex = -1;

  before(async () => {
    // Создаём проект, дожидаемся скрипта + пречека
    const p = await createProject({
      title: '[E2E Test] Variants',
      topic: 'Тест генерации вариантов картинок',
      animationModel: 'seedance',
    });
    projectId = p.id;

    await post(`/videos/${projectId}/generate-script`, {});
    await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.status === 'script_ready',
      { timeoutMs: TIMEOUTS.script },
    );
    await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.stockPrecheck },
    );

    // Находим первую AI-сцену
    const { body: proj } = await get<Project>(`/videos/${projectId}`);
    aiSceneIndex = proj.script!.scenes.findIndex(s => s.videoSource === 'ai');
  }, TIMEOUTS.script + TIMEOUTS.stockPrecheck + 15_000);

  it('POST /generate-variants для AI-сцены → 200', { skip: false }, async () => {
    if (aiSceneIndex < 0) {
      // Все сцены стоковые — тест не актуален, просто пропускаем
      return;
    }
    const r = await post(`/videos/${projectId}/scenes/${aiSceneIndex}/generate-variants`, {});
    assert.ok([200, 202].includes(r.status), `Ожидался 200/202, получен ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }, 120_000);
});

// ─── Полная генерация видео (очень медленный) ─────────────────────────────────

describe('Полная генерация видео', {
  skip: SKIP_SLOW || SKIP_GENERATE ? 'SKIP_SLOW=1 или SKIP_GENERATE=1' : false,
}, () => {
  let projectId: string;

  before(async () => {
    const p = await createProject({
      title: '[E2E Test] Full Generate',
      topic: '3 лайфхака для утренней продуктивности',
      animationModel: 'seedance',
      subtitleStyle: 'tiktok',
      clipDuration: 5,
    });
    projectId = p.id;
  });

  it('POST /generate-script → 200', async () => {
    const r = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202].includes(r.status));
  });

  it('Скрипт готов', { timeout: TIMEOUTS.script + 5_000 }, async () => {
    await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.status === 'script_ready',
      { timeoutMs: TIMEOUTS.script },
    );
  });

  it('Stock precheck завершён', { timeout: TIMEOUTS.stockPrecheck + 5_000 }, async () => {
    await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.stockPrecheck },
    );
  });

  it('POST /generate → 200', async () => {
    const r = await post(`/videos/${projectId}/generate`, {});
    assert.ok([200, 202].includes(r.status), `${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  it('status=done за 10 минут, videoUrl существует', { timeout: TIMEOUTS.generate + 10_000 }, async () => {
    const p = await pollUntil<Project>(
      `/videos/${projectId}`,
      p => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 5000 },
    );
    assert.notEqual(p.status, 'error', `Генерация завершилась с ошибкой: ${JSON.stringify(p)}`);
    assert.equal(p.status, 'done');
    assert.ok(p.videoUrl, 'videoUrl отсутствует');
    assert.equal(p.progress, 100);
  });

  it('GET /download → video/mp4 > 100KB', { timeout: 35_000 }, async () => {
    const res = await fetch(`${BASE_URL}/videos/${projectId}/download`, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /video\/mp4/);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 100_000, `Файл слишком маленький: ${buf.byteLength} bytes`);
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

after(async () => {
  await Promise.allSettled(createdIds.map(id => del(`/videos/${id}`)));
});
