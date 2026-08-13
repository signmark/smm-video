/**
 * SM-18: detect platform mentions in a prompt that the user typed by hand
 * (i.e. literal name like «Facebook» or «Telegram»), and report the ones that
 * are NOT connected for the campaign.
 *
 * Канонический список названий берётся из `server/services/social-prompt.ts`
 * (PLATFORM_NAMES_RU) — единый источник, чтобы разбор промта и
 * подстановка `[socialNetworks]` не разъехались. На клиенте дублируется
 * (server-side код в браузер не доходит), но mirrored and watched в
 * SM-18 test: если добавится новая платформа в сервисе, добавится и здесь.
 *
 * Acceptance:
 *  1. использует тот же список литеральных названий, что и
 *     `normalizePlatformMentionsToPlaceholder` (common source of truth);
 *  2. отрицающий контекст («не использовать Facebook») НЕ вызывает warning —
 *     см. `isNegatedBefore` ниже;
 *  3. возвращает только те платформы, что упомянуты положительно
 *     и не подключены по `isPlatformConnected`.
 */

import { PLATFORM_NAMES_RU, type ConnectablePlatform } from './platform-connection';

/** Negative tokens — «не использовать», «избегать», «don't», «avoid» и т.д.
 *  Перед упоминанием сети в окне ~4 токенов. */
const NEGATION_TOKENS = new Set([
  'не', 'но', 'без', 'кроме', 'избегай', 'избегать', 'избегайте',
  'нельзя', 'запрещено', 'запрещается', 'не пиши', 'не используй',
  'не используем', 'не упоминай', 'не надо', 'не нужно', 'исключая',
  "don't", 'not', 'against', 'avoid', 'no',
]);

/** «Чёрное» окно для контекстного поиска. */
const CONTEXT_WINDOW = 50;

/** true, если перед matchIndex в ближайших ~CONTEXT_WINDOW chars есть
 *  слово-отрицание. Границей служат . ; ! ? и перенос строки. */
export function isNegatedBefore(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - CONTEXT_WINDOW);
  const before = text.slice(start, matchIndex);
  // Границы — точка/запятая/!/?. После границы сбрасываем — нам важно
  // ближайшее предложение, а не вся история.
  const lastBreak = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf(';'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
    before.lastIndexOf('\n'),
  );
  const window = before.slice(lastBreak + 1).toLowerCase();
  // Разбиваем на токены по не-буквенным границам, оставляем апострофы —
  // иначе "don't" разорвётся на ["don", "t"] и не попадёт в NEGATION_TOKENS.
  const tokens = window.split(/[^a-zа-яё'’]+/i).filter(Boolean);
  // Проверяем последние ~4 токена (ближайшие к matchIndex).
  const last4 = tokens.slice(-4);
  return last4.some((t) => NEGATION_TOKENS.has(t));
}

/** Какие платформы упомянуты в тексте промта (в любом регистре, как
 *  литеральное название). Не учитывает контекст — для контекста
 *  используйте `extractUnconnectedMentions`. */
export function extractPlatformMentions(text: string): ConnectablePlatform[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set<ConnectablePlatform>();
  for (const [platform, name] of Object.entries(PLATFORM_NAMES_RU)) {
    if (lower.includes(name.toLowerCase())) {
      found.add(platform as ConnectablePlatform);
    }
  }
  return Array.from(found);
}

/** Возвращает те платформы, что упомянуты в промте положительно
 *  (без «не использовать ...» в ближайшем контексте) и не подключены у
 *  кампании. Используется для показа warning под полем промта. */
export function extractUnconnectedMentions(params: {
  prompt: string;
  isConnected: (platform: ConnectablePlatform) => boolean;
}): ConnectablePlatform[] {
  const mentions = extractPlatformMentions(params.prompt);
  const unconnected: ConnectablePlatform[] = [];
  for (const platform of mentions) {
    if (params.isConnected(platform)) continue;
    // Ищем первое вхождение в тексте и проверяем контекст.
    const idx = params.prompt.toLowerCase().indexOf(PLATFORM_NAMES_RU[platform].toLowerCase());
    if (idx < 0) continue; // на всякий случай — не должно случиться
    if (isNegatedBefore(params.prompt, idx)) continue;
    unconnected.push(platform);
  }
  return unconnected;
}