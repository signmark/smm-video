/**
 * Смысл проверок: массовая адаптация не должна стирать запись о публикации, а
 * итоговое сообщение не должно выдавать пропуск за успех или за поломку.
 */
import { describe, it, expect } from 'vitest';
import { bulkAdaptToastText, isProtectedFromBulkAdapt } from '../bulk-adapt';

describe('кого массовая адаптация трогать не должна', () => {
  it('опубликованные и запланированные защищены', () => {
    expect(isProtectedFromBulkAdapt('published')).toBe(true);
    expect(isProtectedFromBulkAdapt('scheduled')).toBe(true);
  });

  it('частично опубликованный тоже защищён — часть площадок уже живёт', () => {
    expect(isProtectedFromBulkAdapt('partially_published')).toBe(true);
    expect(isProtectedFromBulkAdapt('partial')).toBe(true);
  });

  it('черновик адаптировать можно', () => {
    expect(isProtectedFromBulkAdapt('draft')).toBe(false);
  });

  it('статус в другом регистре или с пробелами не обходит защиту', () => {
    expect(isProtectedFromBulkAdapt(' Published ')).toBe(true);
    expect(isProtectedFromBulkAdapt('SCHEDULED')).toBe(true);
  });

  it('отсутствующий статус не считается защищённым молча', () => {
    expect(isProtectedFromBulkAdapt(undefined)).toBe(false);
    expect(isProtectedFromBulkAdapt(null)).toBe(false);
  });
});

describe('что сказано человеку после прогона', () => {
  it('когда всё прошло — только результат', () => {
    const text = bulkAdaptToastText({
      ok: 3, total: 3, skippedProtected: 0, skippedEmpty: 0, cancelled: false,
    });
    expect(text).toBe('Адаптация завершена: 3 из 3 постов.');
  });

  it('пропуск назван пропуском и объяснён, а не спрятан в «не удалось»', () => {
    const text = bulkAdaptToastText({
      ok: 1, total: 3, skippedProtected: 2, skippedEmpty: 0, cancelled: false,
    });
    expect(text).toContain('Пропущено опубликованных и запланированных: 2');
    expect(text).toContain('не тронуты');
    expect(text).not.toContain('Не удалось');
  });

  it('настоящая неудача видна отдельно от пропуска', () => {
    const text = bulkAdaptToastText({
      ok: 1, total: 4, skippedProtected: 1, skippedEmpty: 1, cancelled: false,
    });
    expect(text).toContain('Пропущено опубликованных и запланированных: 1');
    expect(text).toContain('Пропущено без текста: 1');
    expect(text).toContain('Не удалось: 1');
  });

  it('остановка кнопкой не превращается в отчёт о неудачах', () => {
    const text = bulkAdaptToastText({
      ok: 1, total: 5, skippedProtected: 1, skippedEmpty: 0, cancelled: true,
    });
    expect(text).toContain('Адаптация остановлена');
    expect(text).toContain('остались выбранными');
    expect(text).not.toContain('Не удалось');
  });

  it('когда защищены все — не пишем «завершена» без объяснения', () => {
    const text = bulkAdaptToastText({
      ok: 0, total: 2, skippedProtected: 2, skippedEmpty: 0, cancelled: false,
    });
    expect(text).toContain('0 из 2');
    expect(text).toContain('Пропущено опубликованных и запланированных: 2');
  });
});
