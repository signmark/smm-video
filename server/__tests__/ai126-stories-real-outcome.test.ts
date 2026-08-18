import { describe, expect, it } from 'vitest';

import { resolveStoriesPublishOutcome } from '../routes/stories';

/**
 * AI-126 (2026-08-18): ответ человеку при публикации Stories должен отражать РЕАЛЬНЫЙ
 * исход, а не «успешно» всегда. Чистая функция resolveStoriesPublishOutcome разбирает
 * исходы Promise.allSettled по площадкам; обработчик отвечает успехом ТОЛЬКО если
 * хоть одна площадка опубликовала (successful.length > 0).
 *
 * Поведенческий тест (по @Clause_Dev_Hermi): проверяем результат, а не текст. Мутация —
 * если убрать учёт успеха (например, всегда считать успешным) — тесты краснеют.
 */

describe('AI-126: resolveStoriesPublishOutcome — реальный исход публикации Stories', () => {
  it('все площадки упали => 0 успешных, все в failed (= ответ человеку НЕ успех)', () => {
    const results: Array<PromiseSettledResult<{ type: string; success: boolean; error?: unknown }>> = [
      { status: 'fulfilled', value: { type: 'vk', success: false, error: 'token expired' } },
      { status: 'rejected', reason: new Error('gate down') },
      { status: 'fulfilled', value: { type: 'instagram', success: false, error: 'graph api 400' } },
    ];
    const out = resolveStoriesPublishOutcome(results);
    expect(out.successful).toHaveLength(0);
    expect(out.failed).toHaveLength(3);
    expect(out.successful.length > 0).toBe(false); // => обработчик вернёт HTTP-ошибку
    // Rejected тоже попадает в failed (площадка не ответила).
    expect(out.failed.find((f) => f.type === 'unknown')?.error).toBeTruthy();
  });

  it('часть площадок успешна => они в successful (успех только для реально опубликованных)', () => {
    const results: Array<PromiseSettledResult<{ type: string; success: boolean; error?: unknown }>> = [
      { status: 'fulfilled', value: { type: 'vk', success: true } },
      { status: 'fulfilled', value: { type: 'instagram', success: false, error: 'graph api 400' } },
    ];
    const out = resolveStoriesPublishOutcome(results);
    expect(out.successful.map((s) => s.type)).toEqual(['vk']);
    expect(out.failed.map((f) => f.type)).toEqual(['instagram']);
    expect(out.successful.length > 0).toBe(true); // частичный успех => ответ 200
  });

  it('пусто / нет публикаций => не успех (ничего не отправлено)', () => {
    const out = resolveStoriesPublishOutcome([]);
    expect(out.successful).toHaveLength(0);
    expect(out.failed).toHaveLength(0);
    expect(out.successful.length > 0).toBe(false);
  });
});
