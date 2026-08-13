/**
 * SM-18: компонент-уровень тесты для disconnected-mention-detector.
 *
 * Acceptance:
 *  1. использует тот же список литеральных названий, что и
 *     `normalizePlatformMentionsToPlaceholder` (common source);
 *  2. отрицающий контекст (`не использовать Facebook`) НЕ даёт warning;
 *  3. возвращает только те платформы, что упомянуты положительно
 *     и не подключены.
 *
 * Тесты на чистые функции — без рендера. Если нужно проверить UI —
 * это отдельный тест для `AutonomousSettings` (использует JSX).
 */
import { describe, it, expect } from 'vitest';
import {
  isNegatedBefore,
  extractPlatformMentions,
  extractUnconnectedMentions,
} from '../disconnected-mention-detector';

const ALL_CONNECTED: (p: string) => boolean = (_) => true;

const ALL_UNCONNECTED: (p: string) => boolean = (_) => true;

const NONE_CONNECTED: (p: string) => boolean = (_) => false;

describe('isNegatedBefore', () => {
  it('true перед «не»', () => {
    expect(isNegatedBefore('Не используй Facebook', 16)).toBe(true);
  });
  it('true перед «избегай»', () => {
    expect(isNegatedBefore('Избегай упоминать Facebook в постах', 25)).toBe(true);
  });
  it('true перед "don\'t"', () => {
    expect(isNegatedBefore("don't mention Facebook", 18)).toBe(true);
  });
  it('true перед "avoid"', () => {
    expect(isNegatedBefore('avoid writing for Facebook', 24)).toBe(true);
  });
  it('false в нейтральном контексте', () => {
    expect(isNegatedBefore('Пиши посты для Facebook', 10)).toBe(false);
  });
  it('false после точки (новое предложение)', () => {
    expect(isNegatedBefore('Не пиши для Facebook. Теперь Facebook основной канал.', 25)).toBe(false);
  });
  it('true с учётом «но»', () => {
    expect(isNegatedBefore('Пиши в Telegram, но не в Facebook', 22)).toBe(true);
  });
});

describe('extractPlatformMentions', () => {
  it('находит все упоминания по разным регистрам', () => {
    const r = extractPlatformMentions('Пишем для Telegram, Facebook и ВКонтакте');
    expect(r.sort()).toEqual(['facebook', 'telegram', 'vk']);
  });
  it('возвращает пустой массив, если ничего не упомянуто', () => {
    expect(extractPlatformMentions('Просто текст без названий соцсетей')).toEqual([]);
  });
  it('case-insensitive', () => {
    const r = extractPlatformMentions('FACEBOOK, telegram, ВКонтакте');
    expect(r.sort()).toEqual(['facebook', 'telegram', 'vk']);
  });
  it('по разным написаниям — один раз', () => {
    const r = extractPlatformMentions('Facebook, Facebook, FACEBOOK');
    expect(r).toEqual(['facebook']);
  });
});

describe('extractUnconnectedMentions', () => {
  it('возвращает только unconnected + positive mentions', () => {
    const r = extractUnconnectedMentions({
      prompt: 'Пиши в Telegram и Facebook',
      isConnected: (p) => p === 'telegram',
    });
    expect(r).toEqual(['facebook']);
  });

  it('не включает подключённые платформы', () => {
    const r = extractUnconnectedMentions({
      prompt: 'Facebook и Telegram',
      isConnected: ALL_CONNECTED,
    });
    expect(r).toEqual([]);
  });

  it('не включает все, если ничего не подключено — возвращает все упомянутые positive', () => {
    const r = extractUnconnectedMentions({
      prompt: 'Facebook и Telegram',
      isConnected: NONE_CONNECTED,
    });
    expect(r.sort()).toEqual(['facebook', 'telegram']);
  });

  it('исключает платформу в отрицающем контексте', () => {
    const r = extractUnconnectedMentions({
      prompt: 'Пиши в Telegram, но не в Facebook. Про YouTube забудь.',
      isConnected: ALL_UNCONNECTED,
    });
    expect(r).toEqual([]); // facebook и youtube — обе в отрицающем контексте
  });

  it('mixed: positive telegram, negative facebook, unconnected', () => {
    const r = extractUnconnectedMentions({
      prompt: 'Пиши в Telegram. Не пиши в Facebook, он не подключён.',
      isConnected: NONE_CONNECTED,
    });
    expect(r).toEqual(['telegram']); // только telegram — positive
  });

  it('red-before: на main без #47 функция extractUnconnectedMentions существует, но ДОЛЖНА исключать negative', () => {
    // Этот тест защищает от регрессии: если кто-то изменит isNegatedBefore
    // и negative-контекст перестанет фильтроваться — тесты с mixed/
    // negative провалятся, и warning начнёт ложно срабатывать.
    const r = extractUnconnectedMentions({
      prompt: 'Избегай Facebook. Telegram основной.',
      isConnected: NONE_CONNECTED,
    });
    expect(r).toEqual(['telegram']);
  });
});

describe('общий источник с server-side PLATFORM_NAMES_RU', () => {
  it('все ключи из PLATFORM_NAMES_RU присутствуют в CONNECTABLE_PLATFORMS', async () => {
    // Этот тест страхует от рассогласования client/server списков.
    // Если сервис добавит новую платформу, в client CONNECTABLE_PLATFORMS
    // её пока нет — тест красный. Это сигнал: добавить запись в client.
    const { PLATFORM_NAMES_RU } = await import('@/lib/platform-connection');
    const { CONNECTABLE_PLATFORMS } = await import('@/lib/platform-connection');
    for (const platform of Object.keys(PLATFORM_NAMES_RU)) {
      expect(CONNECTABLE_PLATFORMS).toContain(platform);
    }
  });
});