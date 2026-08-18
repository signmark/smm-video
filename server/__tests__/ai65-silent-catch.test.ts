/**
 * AI-65: молчание в catch должно быть решением, а не забывчивостью.
 *
 * ЧТО БЫЛО. В планировщике публикаций одиннадцать раз подряд стояло
 * `try { ...уведомление... } catch {}`. Молчание там верное: публикация уже
 * состоялась и записана, непоказанное уведомление её не отменяет, а уронить
 * публикацию из-за уведомления было бы хуже. Но записанное пустым `catch {}`
 * одиннадцать раз, это решение неотличимо от забытого — и рядом, в том же
 * файле, точно так же молчали два места, где отказ прятать нельзя.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Первая часть — поведение: отказ вещателя не выпускается
 * наружу, но и не исчезает. Вторая — сканер (правило 49): он стережёт, что
 * пустых catch в планировщике не осталось и что два опасных места заговорили.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logEvent } from '../utils/logger';
import { notifyPublished, setNotificationBroadcaster } from '../services/notification-bus';

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;

function events(name: string): Array<Record<string, any>> {
  return mockLogEvent.mock.calls
    .filter((call) => call[0] === name)
    .map((call) => call[1] as Record<string, any>);
}

const scheduler = () => readFileSync(join(__dirname, '../services/publish-scheduler.ts'), 'utf-8');

beforeEach(() => {
  mockLogEvent.mockReset();
  setNotificationBroadcaster(() => {});
});

describe('AI-65: уведомление о публикации не может уронить публикацию', () => {
  it('доходит до вещателя целиком', () => {
    const seen: Array<[string, any]> = [];
    setNotificationBroadcaster((type, data) => seen.push([type, data]));

    notifyPublished({ contentId: 'c-1', platform: 'vk', type: 'story' });

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('content_published');
    expect(seen[0][1]).toMatchObject({ contentId: 'c-1', platform: 'vk', type: 'story' });
  });

  it('отказ вещателя наружу не выпускается', () => {
    setNotificationBroadcaster(() => {
      throw new Error('шина уведомлений недоступна');
    });

    // К этому моменту пост уже опубликован и запись о нём сохранена. Исключение
    // отсюда обрушило бы обработку публикации из-за второстепенного шага.
    expect(() => notifyPublished({ contentId: 'c-2', platform: 'telegram' })).not.toThrow();
  });

  it('но и не исчезает бесследно', () => {
    setNotificationBroadcaster(() => {
      throw new Error('шина уведомлений недоступна');
    });

    notifyPublished({ contentId: 'c-3', platform: 'instagram' });

    const failed = events('notification.broadcast_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ contentId: 'c-3', platform: 'instagram' });
    expect(failed[0].reason).toContain('шина уведомлений недоступна');
  });

  it('успешная отправка ничего не пишет', () => {
    notifyPublished({ contentId: 'c-4', platform: 'facebook' });
    expect(events('notification.broadcast_failed')).toHaveLength(0);
  });
});

describe('AI-65: в планировщике не осталось молчания по недосмотру', () => {
  it('пустых catch нет вовсе', () => {
    // Пустой catch в этом файле означает проглоченный отказ на пути публикации —
    // самом близком к живым людям.
    expect(scheduler()).not.toContain('catch {}');
  });

  it('уведомления идут через общее место, а не одиннадцать раз подряд', () => {
    const s = scheduler();
    expect(s).toContain("import { notifyPublished } from './notification-bus';");
    // Прямой вызов вещателя из планировщика вернул бы обратно и дублирование,
    // и пустой catch рядом с ним.
    expect(s).not.toContain("broadcastNotification('content_published'");
  });
});

describe('AI-65: два места, где молчать было нельзя', () => {
  it('несброшенный протухший токен после 401 записывается', () => {
    const s = scheduler();
    const idx = s.indexOf("'scheduler.token_reset_failed'");
    expect(idx).toBeGreaterThan(0);
    // Уровень ошибки, а не отладки: пока токен не сброшен, каждый цикл получает
    // 401, и снаружи это «публикации просто не идут».
    expect(s.slice(idx, idx + 300)).toContain("'error'");
  });

  it('нечитаемые ключи площадки записываются', () => {
    const s = scheduler();
    const idx = s.indexOf("'scheduler.platform_keys_unreadable'");
    expect(idx).toBeGreaterThan(0);
    expect(s.slice(idx, idx + 300)).toContain("platform: 'tiktok'");
  });
});
