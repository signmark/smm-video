/**
 * Бюджет попыток захвата слота у промокода БЕЗ `max_uses`.
 *
 * Находка ревью Codex 29.07.2026 (P3): потолок был жёстким — 200 попыток. Это
 * скрытая бизнес-ёмкость. Покупатель, который проиграл 200 гонок подряд, получал
 * ошибку, хотя свободные слоты были и код объявлен безлимитным. Проверить это
 * интеграционным тестом «210 параллельных запросов» нельзя: там каждый запрос
 * почти не конкурирует и до потолка не доходит вовсе, тест зеленеет и без фикса.
 *
 * Поэтому конфликт форсируется напрямую: фейковый Directus отвергает вставку,
 * пока номер слота меньше порога, и на каждой попытке показывает НОВУЮ занятость
 * — то есть конкуренты реально двигаются. Старый код падал на 201-й попытке,
 * новый ждёт, пока идёт прогресс.
 *
 * Обратная сторона инварианта — зацикливание. Если занятость перестала меняться,
 * ждать больше нечего, и попытки обязаны кончиться retryable-ошибкой.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };
process.env.DIRECTUS_URL = 'https://directus.test';
process.env.DIRECTUS_STATIC_TOKEN = 'admin-token-test';

const json = (body: any, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any);

const uniqueViolation = () =>
  json({ errors: [{ message: 'Value has to be unique.' }] }, false, 400);

const PROMO: any = { id: 'promo-1', code: 'FREE', max_uses: null, discount_percent: 50 };

/**
 * @param acceptFromSlot начиная с какого номера вставка проходит
 * @param growOccupancy растёт ли занятость между попытками (наблюдаемый прогресс)
 */
function installDirectus(acceptFromSlot: number, growOccupancy: boolean, initialOccupancy = 0) {
  let occupancy = initialOccupancy;
  const state = { posts: 0, reads: 0 };

  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    const method = init?.method || 'GET';

    if (method === 'GET') {
      state.reads++;
      // Чтение занятых слотов: отдаём occupancy строк подряд.
      if (u.includes('fields=slot_index')) {
        const rows = Array.from({ length: occupancy }, (_, i) => ({ slot_index: i, status: 'reserved' }));
        return json({ data: rows });
      }
      // Поиск по payment_id / user_lock / slot_lock — держателей не показываем,
      // чтобы путь шёл именно в «гонку за номер», а не в reclaim.
      return json({ data: [] });
    }

    if (method === 'POST') {
      state.posts++;
      const body = JSON.parse(init.body);
      if (growOccupancy) occupancy++;
      if (body.slot_index < acceptFromSlot) return uniqueViolation();
      return json({ data: { id: `res-${body.slot_index}` } });
    }

    return json({ data: {} });
  }));

  return state;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...OLD_ENV, DIRECTUS_URL: 'https://directus.test', DIRECTUS_STATIC_TOKEN: 'admin-token-test' };
});

describe('код без max_uses: потолка в 200 попыток больше нет', () => {
  it('слот занимается и после 200+ проигранных гонок, пока идёт прогресс', async () => {
    const { reservePromo } = await import('../services/promo-reservation');
    // 250 > старого жёсткого потолка 200: без фикса сюда не дойти.
    const state = installDirectus(250, true);

    const result = await reservePromo({ promo: PROMO, userId: 'user-1', paymentId: 'order-1' });

    expect(result.ok).toBe(true);
    expect(state.posts).toBeGreaterThan(200);
  }, 60_000);

  it('без наблюдаемого прогресса попытки кончаются retryable-ошибкой, а не зацикливаются', async () => {
    const { reservePromo, PromoReservationUnavailableError } = await import('../services/promo-reservation');
    // Занятость не меняется: ждать нечего.
    installDirectus(Number.MAX_SAFE_INTEGER, false);

    await expect(
      reservePromo({ promo: PROMO, userId: 'user-1', paymentId: 'order-2' }),
    ).rejects.toBeInstanceOf(PromoReservationUnavailableError);
  }, 60_000);
});

describe('код с max_uses сохраняет прежний потолок', () => {
  it('исчерпанный код отвечает exhausted, а не бесконечно крутится', async () => {
    const { reservePromo } = await import('../services/promo-reservation');
    // Все три слота реально заняты — свободных номеров нет.
    installDirectus(Number.MAX_SAFE_INTEGER, false, 3);

    const result = await reservePromo({
      promo: { ...PROMO, max_uses: 3 },
      userId: 'user-1',
      paymentId: 'order-3',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('exhausted');
  }, 60_000);
});
