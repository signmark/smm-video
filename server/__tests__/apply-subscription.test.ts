/**
 * Применение подписки с проверкой записи (AI-64).
 *
 * Главный тест здесь — «PATCH вернул 200, а в базе осталось старое». Именно этот
 * случай 01.08.2026 дал владельцу ответ «✅ Подписка активирована» при том, что
 * пользователь остался без тарифа: обработчик считал успехом код ответа и на
 * этом останавливался.
 */

import { describe, it, expect, vi } from 'vitest';
import { applySubscription } from '../services/apply-subscription';

const OK = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const FAIL = (status: number, body = 'err') => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body,
});

const base = {
  directusUrl: 'http://directus:8055',
  adminToken: 'token',
  userId: 'u1',
  planValue: 'pro',
  expireDateStr: '2026-08-31',
};

describe('applySubscription', () => {
  it('успех только когда прочитанное совпало с запрошенным', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(OK({ data: {} }))
      .mockResolvedValueOnce(OK({ data: { plan: 'pro', expire_date: '2026-08-31' } }));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res.ok).toBe(true);
    // Именно два вызова: запись и обязательное чтение обратно.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('200 на запись, но старое значение в базе — НЕ успех', async () => {
    // Ровно инцидент 01.08: Directus принял запрос и ничего не изменил.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(OK({ data: {} }))
      .mockResolvedValueOnce(OK({ data: { plan: 'free', expire_date: '2026-05-15' } }));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-applied');
    // В отчёт должно попасть и ожидаемое, и фактическое — иначе разбирать нечем.
    expect(res).toMatchObject({
      expected: { plan: 'pro', expire_date: '2026-08-31' },
      actual: { plan: 'free', expire_date: '2026-05-15' },
    });
  });

  it('дата с временем считается совпавшей по дню', async () => {
    // Directus возвращает то '2026-08-31', то '2026-08-31T00:00:00'.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(OK({ data: {} }))
      .mockResolvedValueOnce(OK({ data: { plan: 'pro', expire_date: '2026-08-31T00:00:00' } }));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res.ok).toBe(true);
  });

  it('отказ на записи возвращается как write-failed со статусом', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(FAIL(403, 'forbidden'));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res).toMatchObject({ ok: false, reason: 'write-failed', status: 403 });
    // Читать обратно после неудачной записи незачем.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('не смогли прочитать обратно — успехом не считаем', async () => {
    // Подтвердить нечем: молча отвечать «активировано» здесь тоже нельзя.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(OK({ data: {} }))
      .mockResolvedValueOnce(FAIL(500));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res).toMatchObject({ ok: false, reason: 'readback-failed', status: 500 });
  });

  it('несовпадение только по тарифу тоже ловится', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(OK({ data: {} }))
      .mockResolvedValueOnce(OK({ data: { plan: 'basic', expire_date: '2026-08-31' } }));

    const res = await applySubscription({ ...base, fetchImpl: fetchImpl as never });

    expect(res).toMatchObject({ ok: false, reason: 'not-applied' });
  });
});
