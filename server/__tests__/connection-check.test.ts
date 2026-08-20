/**
 * SM-41. Смысл проверок: исход живой проверки связи должен переживать закрытие
 * окна, а «не проверяли» — не выдавать себя за «связь есть».
 */
import { describe, it, expect } from 'vitest';
import {
  readConnectionCheck,
  withConnectionCheck,
  isCheckablePlatform,
  CHECKABLE_PLATFORMS,
} from '../services/connection-check';

describe('хранение исхода проверки', () => {
  it('исход кладётся к площадке и не задевает остальные', () => {
    const before = { telegram: { chatId: '@x', token: 't' }, vk: { groupId: '1' } };
    const after = withConnectionCheck(before, 'telegram', { at: '2026-08-20T07:00:00.000Z', ok: false, reason: 'Бот выгнан из канала' });
    expect(after.telegram.chatId).toBe('@x');
    expect(after.telegram.token).toBe('t');
    expect(after.telegram.lastCheck).toEqual({ at: '2026-08-20T07:00:00.000Z', ok: false, reason: 'Бот выгнан из канала' });
    expect(after.vk).toEqual({ groupId: '1' });
  });

  it('исходные настройки не портятся на месте', () => {
    const before: any = { telegram: { chatId: '@x' } };
    withConnectionCheck(before, 'telegram', { at: '2026-08-20T07:00:00.000Z', ok: true });
    expect(before.telegram.lastCheck).toBeUndefined();
  });

  it('площадка без настроек тоже получает исход', () => {
    const after = withConnectionCheck({}, 'threads', { at: '2026-08-20T07:00:00.000Z', ok: true });
    expect(after.threads.lastCheck.ok).toBe(true);
  });

  it('пустые настройки кампании не роняют запись', () => {
    expect(withConnectionCheck(null, 'vk', { at: '2026-08-20T07:00:00.000Z', ok: true }).vk.lastCheck.ok).toBe(true);
  });
});

describe('чтение исхода', () => {
  it('целый исход читается как есть', () => {
    expect(readConnectionCheck({ lastCheck: { at: '2026-08-20T07:00:00.000Z', ok: true } }))
      .toEqual({ at: '2026-08-20T07:00:00.000Z', ok: true });
  });

  it('исход без времени — это не исход', () => {
    // Соврать «связь есть» хуже, чем честно сказать «не проверяли».
    expect(readConnectionCheck({ lastCheck: { ok: true } })).toBeNull();
    expect(readConnectionCheck({ lastCheck: { at: 'вчера', ok: true } })).toBeNull();
  });

  it('исход без вердикта — это не исход', () => {
    expect(readConnectionCheck({ lastCheck: { at: '2026-08-20T07:00:00.000Z' } })).toBeNull();
    expect(readConnectionCheck({ lastCheck: { at: '2026-08-20T07:00:00.000Z', ok: 'да' } })).toBeNull();
  });

  it('площадка без проверки отличима от площадки без настроек', () => {
    expect(readConnectionCheck({ chatId: '@x' })).toBeNull();
    expect(readConnectionCheck(undefined)).toBeNull();
  });

  it('пустая причина отказа не хранится пустой строкой', () => {
    expect(readConnectionCheck({ lastCheck: { at: '2026-08-20T07:00:00.000Z', ok: false, reason: '  ' } }))
      .toEqual({ at: '2026-08-20T07:00:00.000Z', ok: false });
  });
});

describe('набор проверяемых площадок', () => {
  it('шесть площадок, а не одна', () => {
    expect(CHECKABLE_PLATFORMS).toHaveLength(6);
    expect(CHECKABLE_PLATFORMS).toContain('telegram');
    expect(CHECKABLE_PLATFORMS).toContain('youtube');
  });

  it('чужое имя площадки не проходит', () => {
    expect(isCheckablePlatform('telegram')).toBe(true);
    expect(isCheckablePlatform('tiktok')).toBe(false);
    expect(isCheckablePlatform(null)).toBe(false);
  });
});
