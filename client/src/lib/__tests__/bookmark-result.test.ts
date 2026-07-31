/**
 * Разбор ответа закладок (AI-52).
 *
 * Баг с экрана владельца: кнопка «Добавить в закладки», тост «Удалено из
 * закладок», подпись кнопки не меняется. В базе при этом всё сохранялось
 * правильно — врал только интерфейс, потому что клиент читал поля у конверта
 * `{ success, data: {...} }`, а не внутри него.
 *
 * Здесь закреплено ровно это: реальный ответ сервера обязан читаться как
 * «добавлено», а не «удалено».
 */

import { describe, it, expect } from 'vitest';
import { readBookmarkResult, hasBookmarkState } from '../bookmark-result';

describe('readBookmarkResult', () => {
  // Форма, которую реально отдаёт PATCH /api/campaign-trends/:id/bookmark.
  const realResponse = {
    success: true,
    data: { id: 'trend-1', isBookmarked: true, is_bookmarked: true },
  };

  it('читает состояние из конверта, а не с его верхнего уровня', () => {
    expect(readBookmarkResult(realResponse)).toEqual({ id: 'trend-1', isBookmarked: true });
  });

  it('снятие закладки читается как снятие', () => {
    const res = readBookmarkResult({ success: true, data: { id: 'trend-1', is_bookmarked: false } });
    expect(res.isBookmarked).toBe(false);
    expect(res.id).toBe('trend-1');
  });

  it('плоский ответ тоже понимается', () => {
    // На случай, если ручка когда-нибудь перестанет заворачивать.
    expect(readBookmarkResult({ id: 'x', is_bookmarked: true })).toEqual({ id: 'x', isBookmarked: true });
  });

  it.each([undefined, null, {}, { success: true }, { success: true, data: {} }])(
    'ответ без состояния (%#) не выдаётся за «снято»',
    (payload) => {
      // Ключевое: hasBookmarkState отличает «сервер сказал false» от «сервер
      // промолчал». Раньше оба случая давали одинаковый тост «удалено».
      expect(hasBookmarkState(payload)).toBe(false);
    },
  );

  it('явный false — это ответ, а не молчание', () => {
    expect(hasBookmarkState({ success: true, data: { is_bookmarked: false } })).toBe(true);
  });

  it('нелогическое значение состоянием не считается', () => {
    // Строка 'false' истинна в JS; такой ответ — расхождение контракта, а не
    // «снято». Тот же класс ошибки уже стоил приёмки в AI-39.
    expect(hasBookmarkState({ success: true, data: { is_bookmarked: 'false' } })).toBe(false);
    expect(readBookmarkResult({ success: true, data: { is_bookmarked: 'true' } }).isBookmarked).toBe(false);
  });
});
