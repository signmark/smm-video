/**
 * AI-123v2: остановка по трём прерываниям подряд не наступала никогда.
 *
 * ЧТО БЫЛО. AI-123 научил режим останавливаться после трёх прерванных циклов
 * подряд. Счётчик при этом жил только в памяти процесса: он не сохранялся и не
 * восстанавливался. У кампании с суточным интервалом три прерывания подряд —
 * это трое суток, а выкаток за трое суток несколько, и каждая обнуляла счётчик
 * в ноль. Остановка была написана, но в проде не срабатывала. Ровно та же
 * история уже случалась в SM-20 со счётчиком завершённых циклов.
 *
 * ВТОРОЕ. Даже когда остановка сработает, человек при суточном интервале узнает
 * о поломке на третьи сутки. Теперь после ПЕРВОГО прерывания режим продолжает
 * работать, но говорит человеку, что последняя попытка сорвалась.
 *
 * ВНИМАНИЕ (правило 49). Первая часть — поведение: состояние действительно
 * проходит через сохранение и восстановление. Вторая — сканер исходника: он
 * стережёт места, но поведение цикла целиком не доказывает.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { restoreAutonomousStates, getAutonomousStatusExternal } from '../services/autonomous-ai';

function src(): string {
  return readFileSync(join(__dirname, '../services/autonomous-ai.ts'), 'utf-8');
}

function topbar(): string {
  return readFileSync(join(__dirname, '../../client/src/components/AppShell/Topbar.tsx'), 'utf-8');
}

const PERSIST_DIR = join(process.cwd(), 'data');
const PERSIST_FILE = join(PERSIST_DIR, 'autonomous-states.json');

const SICK = 'ai123v2-sick-campaign';
const HEALTHY = 'ai123v2-healthy-campaign';

/** Сохранённая копия состояния — то, что осталось бы на диске после выкатки. */
function savedState(campaignId: string, extra: Record<string, unknown>) {
  return {
    campaignId,
    userId: 'ai123v2-user',
    authToken: 'header.payload.signature',
    interval: 24,
    postsPerCycle: 1,
    autoSchedule: true,
    platforms: ['telegram'],
    withImages: false,
    startedAt: new Date('2026-08-17T08:28:51.000Z').toISOString(),
    // Пауза здесь только ради теста: восстановление на паузе не заводит
    // таймеров, а состояние в памяти появляется точно так же.
    paused: true,
    cyclesCompleted: 0,
    postsCreated: 0,
    ...extra,
  };
}

let backup: string | null = null;

beforeAll(async () => {
  if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });
  backup = existsSync(PERSIST_FILE) ? readFileSync(PERSIST_FILE, 'utf-8') : null;

  writeFileSync(PERSIST_FILE, JSON.stringify({
    [SICK]: savedState(SICK, {
      consecutiveAbortedCycles: 2,
      lastAbortReason: 'token_refresh_failed',
    }),
    [HEALTHY]: savedState(HEALTHY, {}),
  }, null, 2));

  // Восстановление из БД здесь падает на первом же шаге (axios замокан в
  // setup.ts) и глотается своим catch — остаётся только файловая ветка.
  await restoreAutonomousStates();
});

afterAll(() => {
  if (backup !== null) writeFileSync(PERSIST_FILE, backup);
  else if (existsSync(PERSIST_FILE)) unlinkSync(PERSIST_FILE);
});

describe('AI-123v2: счётчик прерываний переживает перезапуск процесса', () => {
  it('после восстановления счётчик не обнулён', () => {
    const status: any = getAutonomousStatusExternal(SICK);
    expect(status.isActive).toBe(true);
    // Главное утверждение задачи. Если убрать сохранение или восстановление
    // счётчика, здесь окажется 0 — и остановка никогда не наступит.
    expect(status.attention).not.toBeNull();
    expect(status.attention.failedAttempts).toBe(2);
    expect(status.attention.stopsAfter).toBeGreaterThan(2);
  });

  it('причина прерывания тоже переживает перезапуск', () => {
    const status: any = getAutonomousStatusExternal(SICK);
    expect(status.attention.kind).toBe('token_refresh_failed');
  });

  it('исправная кампания предупреждения не показывает', () => {
    const status: any = getAutonomousStatusExternal(HEALTHY);
    expect(status.isActive).toBe(true);
    expect(status.attention).toBeNull();
  });
});

describe('AI-123v2: текст предупреждения', () => {
  it('называет действие и не пугает словами, с которыми человек ничего не сделает', () => {
    const status: any = getAutonomousStatusExternal(SICK);
    const message: string = status.attention.message;

    expect(message).toContain('Войдите в систему заново');
    // «Токен», «сессия», «403» человек не чинит.
    expect(message.toLowerCase()).not.toContain('токен');
    expect(message).not.toContain('403');
    // Человек должен понимать, что режим ещё работает, но недолго.
    expect(message).toContain('Последняя попытка не удалась');
  });
});

describe('AI-123v2: счётчик сохраняется в обе копии состояния', () => {
  it('в запись для базы', () => {
    const s = src();
    const idx = s.indexOf('function stateToRecord');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, s.indexOf('\n}', idx));
    expect(body).toContain('consecutive_aborted_cycles');
    expect(body).toContain('last_abort_reason');
  });

  it('в файловую копию', () => {
    const s = src();
    const idx = s.indexOf('function saveAutonomousPersistenceFile');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, idx + 1800);
    expect(body).toContain('consecutiveAbortedCycles: state.consecutiveAbortedCycles');
  });

  it('и читается обратно из записи базы', () => {
    const s = src();
    expect(s).toContain('rec.consecutive_aborted_cycles');
    expect(s).toContain('rec.last_abort_reason');
  });
});

describe('AI-123v2: момент сохранения', () => {
  it('прерывание сохраняется сразу, но не поверх удалённой копии', () => {
    const s = src();
    const idx = s.indexOf('function noteAbortedCycle');
    expect(idx).toBeGreaterThan(0);
    const body = s.slice(idx, s.indexOf('\n}\n', idx));

    const stopIdx = body.indexOf('stopAutonomousWithReason');
    const saveIdx = body.indexOf('saveAutonomousPersistence(state)');
    expect(stopIdx).toBeGreaterThan(0);
    expect(saveIdx).toBeGreaterThan(0);
    // Остановка удаляет сохранённую копию. Если после неё записать состояние
    // обратно, режим воскреснет после перезапуска — поэтому между ними return.
    expect(body.slice(stopIdx, saveIdx)).toContain('return;');
  });

  it('дошедший до конца цикл снимает и счётчик, и причину', () => {
    const s = src();
    const idx = s.indexOf('state.consecutiveAbortedCycles = 0;');
    expect(idx).toBeGreaterThan(0);
    const around = s.slice(idx, idx + 300);
    expect(around).toContain('state.lastAbortReason = undefined;');
    expect(around).toContain('state.cyclesCompleted++');
  });
});

describe('AI-123v2: предупреждение и остановка различимы глазом', () => {
  it('предупреждение жёлтое и показывается раньше обычного «работает»', () => {
    const t = topbar();
    const warnIdx = t.indexOf('Режим работает, но есть проблема');
    const activeIdx = t.indexOf("t('topbar.autonomous.activeTitle')");
    expect(warnIdx).toBeGreaterThan(0);
    // Иначе обычная зелёная ветка перехватит рендер и предупреждение не увидят.
    expect(warnIdx).toBeLessThan(activeIdx);
    expect(t.slice(warnIdx - 200, warnIdx)).toContain('text-yellow-600');
  });

  it('остановка красная, а не жёлтая', () => {
    const t = topbar();
    const stopIdx = t.indexOf('Режим остановлен');
    expect(stopIdx).toBeGreaterThan(0);
    expect(t.slice(stopIdx - 200, stopIdx + 400)).toContain('text-red-600');
  });
});
