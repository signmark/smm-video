/**
 * SM-41. Смысл проверок: человек не должен видеть зелёное «настроено» рядом с
 * красным «нет связи» без объяснения, а «не проверяли» не должно выдавать себя
 * ни за успех, ни за отказ.
 */
import { describe, it, expect } from 'vitest';
import {
  connectionView,
  socialSummary,
  formatCheckedAt,
  readCheckRecord,
} from '../connection-freshness';

const NOW = new Date('2026-08-20T15:00:00');

describe('состояние одной площадки', () => {
  it('настроек нет — так и говорим', () => {
    expect(connectionView({}, false, NOW)).toEqual({ tone: 'unknown', label: 'Не настроено' });
  });

  it('настроено, но ни разу не проверяли — это отдельное состояние', () => {
    // Раньше тут стояло зелёное «Настроено», и оно обещало то, чего мы не знали.
    expect(connectionView({ chatId: '@x' }, true, NOW))
      .toEqual({ tone: 'unknown', label: 'Связь не проверяли' });
  });

  it('связь есть — с указанием, когда проверяли', () => {
    const v = connectionView({ lastCheck: { at: '2026-08-20T14:20:00', ok: true } }, true, NOW);
    expect(v.tone).toBe('ok');
    expect(v.label).toBe('Связь есть');
    expect(v.checkedAt).toBe('сегодня в 14:20');
  });

  it('связи нет — причина сохраняется рядом', () => {
    const v = connectionView(
      { lastCheck: { at: '2026-08-20T14:20:00', ok: false, reason: 'Бот выгнан из канала' } },
      true,
      NOW,
    );
    expect(v.tone).toBe('fail');
    expect(v.reason).toBe('Бот выгнан из канала');
    expect(v.checkedAt).toBe('сегодня в 14:20');
  });

  it('обрывок исхода считается отсутствием проверки, а не успехом', () => {
    expect(connectionView({ lastCheck: { ok: true } }, true, NOW).label).toBe('Связь не проверяли');
    expect(readCheckRecord({ lastCheck: { at: '2026-08-20T14:20:00' } })).toBeNull();
  });
});

describe('когда проверяли', () => {
  it('только что', () => {
    expect(formatCheckedAt('2026-08-20T14:59:40', NOW)).toBe('только что');
  });

  it('сегодня — со временем суток', () => {
    expect(formatCheckedAt('2026-08-20T09:05:00', NOW)).toBe('сегодня в 09:05');
  });

  it('вчера', () => {
    expect(formatCheckedAt('2026-08-19T22:41:00', NOW)).toBe('вчера в 22:41');
  });

  it('давно — с датой', () => {
    expect(formatCheckedAt('2026-08-11T08:00:00', NOW)).toBe('11 авг в 08:00');
  });

  it('мусор вместо времени не ломает строку', () => {
    expect(formatCheckedAt('позавчера', NOW)).toBe('');
  });
});

describe('подпись строки «Настройки публикации»', () => {
  const notConfigured = { tone: 'unknown' as const, label: 'Не настроено' };

  it('ни одной площадки — не настроены', () => {
    expect(socialSummary([{ platform: 'telegram', view: notConfigured }]))
      .toEqual({ completed: false, label: 'Соцсети не настроены' });
  });

  it('всё в порядке — короткая подпись', () => {
    expect(socialSummary([
      { platform: 'telegram', view: { tone: 'ok', label: 'Связь есть' } },
      { platform: 'vk', view: notConfigured },
    ])).toEqual({ completed: true, label: 'Соцсети настроены' });
  });

  it('живой случай: пять работают, Telegram молчит — галочка остаётся, но называет виновника', () => {
    // Замечание владельца: подпись про все площадки сразу, и она не врёт.
    // Врало молчание рядом с ней.
    const r = socialSummary([
      { platform: 'telegram', view: { tone: 'fail', label: 'Нет связи' } },
      { platform: 'vk', view: { tone: 'ok', label: 'Связь есть' } },
      { platform: 'instagram', view: { tone: 'ok', label: 'Связь есть' } },
    ]);
    expect(r.completed).toBe(true);
    expect(r.label).toBe('Соцсети настроены · Telegram: нет связи');
    // Владелец: человек должен понимать, за что стоит галочка, иначе отказ
    // одной площадки читается как «всё сломалось».
    expect(r.hint).toContain('заполненные доступы');
  });

  it('когда всё работает, объяснять галочку не нужно', () => {
    expect(socialSummary([{ platform: 'vk', view: { tone: 'ok', label: 'Связь есть' } }]).hint)
      .toBeUndefined();
  });

  it('несколько сломанных — называем две и считаем остальные', () => {
    const r = socialSummary([
      { platform: 'telegram', view: { tone: 'fail', label: 'Нет связи' } },
      { platform: 'vk', view: { tone: 'fail', label: 'Нет связи' } },
      { platform: 'facebook', view: { tone: 'fail', label: 'Нет связи' } },
      { platform: 'instagram', view: { tone: 'ok', label: 'Связь есть' } },
    ]);
    expect(r.completed).toBe(true);
    expect(r.label).toBe('Соцсети настроены · Telegram, ВКонтакте и ещё 1: нет связи');
  });

  it('единственная площадка молчит — галочке стоять не за чем', () => {
    // Решение владельца 20.08: отказ одной из нескольких галочку не гасит,
    // отказ единственной — гасит, публиковать всё равно некуда.
    const r = socialSummary([
      { platform: 'telegram', view: { tone: 'fail', label: 'Нет связи' } },
      { platform: 'vk', view: notConfigured },
    ]);
    expect(r.completed).toBe(false);
    expect(r.label).toBe('Нет связи: Telegram');
    expect(r.hint).toContain('ни одна площадка не отвечает');
  });

  it('непроверенная площадка виновником не объявляется', () => {
    expect(socialSummary([
      { platform: 'telegram', view: { tone: 'unknown', label: 'Связь не проверяли' } },
    ])).toEqual({ completed: true, label: 'Соцсети настроены' });
  });
});
