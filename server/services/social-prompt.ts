/**
 * Единый канонический helper для переменной `[socialNetworks]` в глобальном
 * промте кампании (SM-18).
 *
 * Импортируется всеми модельными ingress (autonomous-ai, content-plan-generator,
 * routes/content) и генератором промта (routes/campaigns), чтобы подстановка
 * была ровно одна и ни один путь не оставлял literal «Facebook/Instagram/...»
 * без обработки.
 *
 * Правила (из ревью SM-18):
 *  1. Не мутировать произвольный пользовательский текст в смысловой инверсии:
 *     «Не используй Facebook; пиши для Telegram» НЕ должно превращаться в
 *     «Не используй Telegram; пиши для Telegram».
 *  2. Детерминированно обеспечивать `[socialNetworks]` на границе генератора
 *     промта (до показа/сохранения) — см. `normalizePlatformMentionsToPlaceholder`.
 *  3. Legacy-данные (уже сохранённые промты с literal названиями) чинить только
 *     безопасным, явно ограниченным правилом: заменять упоминание НЕподключённой
 *     сети на плейсхолдер, и ТОЛЬКО вне отрицающих контекстов.
 *
 * Файл не тянет тяжёлые зависимости — импорт безопасен из любого модуля.
 */

export const PLATFORM_NAMES_RU: Record<string, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
};

/** Слова-отрицания, после которых упоминание сети является инструкцией («не
 *  используй Facebook») и не должно заменяться (иначе смысл инвертируется). */
const NEGATION_TOKENS = new Set([
  'не', 'но', 'без', 'кроме', 'избегай', 'избегать', 'избегайте',
  'нельзя', 'запрещено', 'запрещается', 'не пиши', 'не используй',
  'не используем', 'не упоминай', 'не надо', 'не нужно', 'исключая',
  "don't", 'not', 'against', 'avoid',
]);

/** true, если перед позицией matchIndex (без разрыва предложения) есть
 *  слово-отрицание в ближайших ~4 токенах. */
function isNegatedBefore(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 50);
  const before = text.slice(start, matchIndex);
  const breakAt = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf(';'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
    before.lastIndexOf('…'),
  );
  const window = breakAt >= 0 ? before.slice(breakAt + 1) : before;
  const tokens = window
    .toLowerCase()
    .split(/[\s,;.!?…():«»"'/]+/)
    .filter((t) => t.length > 0);
  // Берём хвост: покрывает и «не», и «не использовать» перед названием сети.
  return tokens.slice(-4).some((t) => NEGATION_TOKENS.has(t));
}

/**
 * Регэксп «целое слово» без опоры на ASCII-\b, чтобы корректно ловить и
 * кириллические названия (ВКонтакте).
 */
function wholeWordRegex(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Названия сетей, которые в автосгенерированных/legacy-промтах нормализуются
 *  в плейсхолдер [socialNetworks]. Ключ — платформенный id в нижнем регистре. */
const LITERAL_NAME_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: 'instagram', re: wholeWordRegex('Instagram') },
  { key: 'telegram', re: wholeWordRegex('Telegram') },
  { key: 'vk', re: wholeWordRegex('ВКонтакте') },
  { key: 'vk', re: wholeWordRegex('VK') },
  { key: 'facebook', re: wholeWordRegex('Facebook') },
  { key: 'youtube', re: wholeWordRegex('YouTube') },
  { key: 'tiktok', re: wholeWordRegex('TikTok') },
  { key: 'threads', re: wholeWordRegex('Threads') },
];

/**
 * Шаг 1 (генераторная граница): заменяет литеральные названия соцсетей на
 * плейсхолдер `[socialNetworks]` в СВЕЖЕМ AI-сгенерированном промте.
 *
 * Ограничения:
 *  - Название в отрицающем контексте («не использовать Facebook») сохраняется,
 *    чтобы не инвертировать смысл.
 *  - Нормализуются ВСЕ положительные упоминания (включая уже подключённые сети),
 *    по формуле ревью: чтобы в поле/в базе была именно переменная, а не literal,
 *    иначе после смены подключений текст устареет.
 *
 * Применение только на выводе `/generate-assistant-prompt` (граница свежего вывода).
 * НЕ применяется к произвольному/уже сохранённому пользовательскому тексту.
 */
export function normalizePlatformMentionsToPlaceholder(text: string): string {
  if (!text) return text;
  let out = text;
  for (const pat of LITERAL_NAME_PATTERNS) {
    out = out.replace(pat.re, (match, offset: number) => {
      // Отрицание перед названием — сохраняем как есть (не инвертируем смысл).
      if (isNegatedBefore(out, offset)) return match;
      return '[socialNetworks]';
    });
  }
  return out;
}

/** Значение, которым раскрывается `[socialNetworks]`. */
export function placeholderValue(platforms: string[]): string {
  return platforms.length > 0
    ? platforms.map((p) => PLATFORM_NAMES_RU[p.toLowerCase()] || p).join(', ')
    : 'социальных сетей кампании';
}

/**
 * Единая подстановка для промта перед отправкой в модель (все модельные ingress).
 *
 * СТРОГО: заменяет только плейсхолдер `[socialNetworks]` на подключённые соцсети
 * (или нейтральную фразу). НЕ трогает и НЕ нормализует произвольный пользовательский
 * текст с literal названиями сетей — иначе портим смысл (см. SM-18 ревью: «Сравни
 * Facebook с Telegram» не должно превращаться в «Telegram с Telegram»).
 *
 * Нормализация literal-имён в плейсхолдер живёт ТОЛЬКО на границе свежего
 * AI-сгенерированного промта (см. normalizePlatformMentionsToPlaceholder).
 */
export function substituteSocialNetworks(text: string, platforms: string[]): string {
  if (!text) return text;
  return text.replace(/\[socialNetworks\]/g, placeholderValue(platforms));
}
