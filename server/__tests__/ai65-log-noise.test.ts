/**
 * AI-65 (шаг 1): в логе остаётся то, что можно прочитать.
 *
 * Замер боевых логов 17.08.2026 за шесть часов: 6113 строк, из них 5003 от
 * status-checker — 82 процента. Четыре сообщения по тысяче раз каждое, и все
 * четыре сообщали ноль: «Выбрано: 0 платформ», «Опубликовано: 0», «В ожидании: 0»,
 * «С ошибками: 0».
 *
 * Проверяем не «функция форматирует строку», а решение: когда молчать, когда
 * говорить и что именно называть по именам.
 */
import { describe, it, expect } from 'vitest';
import { formatPlatformStatusLine, type PlatformLists } from '../services/status-checker';

const пусто: PlatformLists = {
  selectedPlatforms: [],
  publishedPlatforms: [],
  pendingPlatforms: [],
  failedPlatforms: [],
};

describe('AI-65: контент без выбранных площадок молчит', () => {
  it('ни одной выбранной — записи нет вовсе', () => {
    // Именно этот случай давал пять строк ни о чём на каждый контент.
    expect(formatPlatformStatusLine('abc', 'Заголовок', пусто)).toBeNull();
  });

  it('молчание не зависит от заголовка', () => {
    expect(formatPlatformStatusLine('abc', null, пусто)).toBeNull();
    expect(formatPlatformStatusLine('abc', '', пусто)).toBeNull();
  });
});

describe('AI-65: когда есть что сказать — одна строка вместо пяти', () => {
  it('всё опубликовано — счётчики без перечисления имён', () => {
    const line = formatPlatformStatusLine('c1', 'Пост', {
      selectedPlatforms: ['vk', 'telegram'],
      publishedPlatforms: ['vk', 'telegram'],
      pendingPlatforms: [],
      failedPlatforms: [],
    });
    expect(line).toBe('Контент c1 "Пост": выбрано 2, опубликовано 2');
    expect(line!.split('\n')).toHaveLength(1);
  });

  it('незавершённые площадки названы по именам: они нужны при разборе', () => {
    const line = formatPlatformStatusLine('c2', 'Пост', {
      selectedPlatforms: ['vk', 'telegram', 'youtube'],
      publishedPlatforms: ['vk'],
      pendingPlatforms: ['telegram', 'youtube'],
      failedPlatforms: [],
    });
    expect(line).toContain('в ожидании 2 (telegram, youtube)');
    expect(line).not.toContain('с ошибками');
  });

  it('упавшие площадки тоже названы', () => {
    const line = formatPlatformStatusLine('c3', 'Пост', {
      selectedPlatforms: ['vk', 'telegram'],
      publishedPlatforms: [],
      pendingPlatforms: [],
      failedPlatforms: ['vk', 'telegram'],
    });
    expect(line).toContain('с ошибками 2 (vk, telegram)');
  });

  it('пустые разделы не печатаются: строка не должна сообщать нули', () => {
    const line = formatPlatformStatusLine('c4', 'Пост', {
      selectedPlatforms: ['vk'],
      publishedPlatforms: ['vk'],
      pendingPlatforms: [],
      failedPlatforms: [],
    });
    expect(line).not.toContain('в ожидании 0');
    expect(line).not.toContain('с ошибками 0');
  });

  it('отсутствующий заголовок не роняет и не печатает undefined', () => {
    const line = formatPlatformStatusLine('c5', undefined, {
      selectedPlatforms: ['vk'],
      publishedPlatforms: [],
      pendingPlatforms: ['vk'],
      failedPlatforms: [],
    });
    expect(line).toContain('Контент c5 ""');
    expect(line).not.toContain('undefined');
  });
});
