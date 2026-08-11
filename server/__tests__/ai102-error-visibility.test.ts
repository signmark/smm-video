/**
 * AI-102: две дыры в наблюдаемости, обе всплыли в одном утреннем инциденте.
 *
 * 1. Публикация во все Telegram-каналы встала, а в карточке контента и в логе
 *    стояло пустое «Ошибка Telegram API». Настоящая причина — отказ TCP/443 к
 *    одному из адресов api.telegram.org — в текст ошибки не попадала вообще,
 *    и диагностика на несколько часов ушла в права ботов.
 * 2. Запись, уже упавшая в статус failed, печаталась планировщиком на каждом
 *    проходе — раз в 30 секунд, бесконечно, — забивая журнал текстом ошибок,
 *    по которым ничего не отправляется.
 *
 * Тесты бьют по боевым функциям: describeTelegramError из telegram-service и
 * shouldLogTerminalError из publish-scheduler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger');

import { describeTelegramError } from '../services/social-platforms/telegram-service';
import { PublishScheduler } from '../services/publish-scheduler';

describe('AI-102: describeTelegramError — текст ошибки не теряется', () => {
  it('порождающий случай: отказ TCP/443 без message даёт код, syscall и адрес', () => {
    const err: any = Object.assign(new Error(''), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '149.154.167.220',
      port: 443,
    });

    const text = describeTelegramError(err);

    expect(text).toContain('ECONNREFUSED');
    expect(text).toContain('149.154.167.220:443');
    expect(text).toContain('connect');
  });

  it('ошибка Telegram API: описание и статус', () => {
    const err: any = {
      response: { status: 400, data: { description: 'Bad Request: chat not found' } },
      message: 'Request failed with status code 400',
    };

    const text = describeTelegramError(err);

    expect(text).toContain('chat not found');
    expect(text).toContain('HTTP 400');
  });

  it('AggregateError: смысл лежит в errors[], снаружи пусто', () => {
    const err: any = new AggregateError(
      [
        Object.assign(new Error('connect ETIMEDOUT 149.154.167.220:443'), { code: 'ETIMEDOUT' }),
        Object.assign(new Error('connect ECONNREFUSED 149.154.167.99:443'), { code: 'ECONNREFUSED' }),
      ],
      '',
    );

    const text = describeTelegramError(err);

    expect(text).toContain('ETIMEDOUT');
    expect(text).toContain('ECONNREFUSED');
  });

  it('ошибка спрятана в cause', () => {
    const err: any = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo EAI_AGAIN api.telegram.org'), { code: 'EAI_AGAIN' }),
    });

    const text = describeTelegramError(err);

    expect(text).toContain('EAI_AGAIN');
    expect(text).toContain('fetch failed');
  });

  it('НИКОГДА не возвращает пустую строку — это и есть исходный дефект', () => {
    for (const err of [{}, null, undefined, new Error(''), 'строка', 0]) {
      const text = describeTelegramError(err as any);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('не дублирует один и тот же текст дважды', () => {
    const err: any = Object.assign(new Error('Unauthorized'), {
      response: { data: { description: 'Unauthorized' } },
    });

    const text = describeTelegramError(err);

    expect(text.match(/Unauthorized/g)).toHaveLength(1);
  });
});

describe('AI-102: shouldLogTerminalError — сохранённая ошибка не повторяется каждые 30с', () => {
  let scheduler: any;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new PublishScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('первый раз печатаем, следующие проходы за час — нет', () => {
    const args: [string, string, string] = ['c1', 'telegram', 'CRITICAL: bot token invalid'];

    expect(scheduler.shouldLogTerminalError(...args)).toBe(true);

    // 120 проходов планировщика с шагом 30 секунд — это час работы
    let printed = 0;
    for (let i = 0; i < 120; i++) {
      vi.advanceTimersByTime(30_000);
      if (scheduler.shouldLogTerminalError(...args)) printed++;
    }

    // ровно один раз — на границе часа
    expect(printed).toBe(1);
  });

  it('смена текста ошибки печатается сразу, без ожидания часа', () => {
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', 'CRITICAL: token invalid')).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', 'CRITICAL: chat not found')).toBe(true);
  });

  it('разные записи и платформы не глушат друг друга', () => {
    const e = 'CRITICAL: token invalid';
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', e)).toBe(true);
    expect(scheduler.shouldLogTerminalError('c2', 'telegram', e)).toBe(true);
    expect(scheduler.shouldLogTerminalError('c1', 'vk', e)).toBe(true);
    expect(scheduler.shouldLogTerminalError('c1', 'telegram', e)).toBe(false);
  });

  it('карта не растёт бесконечно: протухшие ключи вычищаются', () => {
    for (let i = 0; i < 1200; i++) {
      scheduler.shouldLogTerminalError(`c${i}`, 'telegram', 'CRITICAL: token invalid');
    }
    const before = scheduler.terminalErrorLoggedAt.size;

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    scheduler.shouldLogTerminalError('trigger', 'telegram', 'CRITICAL: token invalid');

    expect(before).toBeGreaterThan(1000);
    expect(scheduler.terminalErrorLoggedAt.size).toBeLessThan(before);
  });
});
