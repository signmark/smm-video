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

/** Слово-триггер аудиторной фразы старого авто-генератора. Один `пользовател...`
 *  сам по себе слишком широк (ловит и «Сравни поведение пользователей Facebook»),
 *  поэтому требуется аудиторный маркер «аудитори...» рядом — это сигнатура именно
 *  старого шаблона «Твоя целевая аудитория — ...пользователи Facebook». */
const AUDIENCE_NOUN_STEM_RE = /пользовател(?:ь|и|ей|ям|ями|ями?)/giu;
const AUDIENCE_MARKER_RE = /аудитори(?:я|и|ей|ю|й|ям|ями)/giu;

/** Окно символов, в котором считается связка аудитори-маркера и «пользовател...»
 *  (сигнатура старого шаблона). Заканчивается на границе предложения. */
const LEGACY_WINDOW = 80;

/** Индекс самой ранней границы предложения (. ; ! ? …) от `from`. -1 если нет. */
function findNextSentenceBoundary(text: string, from: number): number {
  let earliest = -1;
  for (const sep of ['.', ';', '!', '?', '…']) {
    const idx = text.indexOf(sep, from);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx;
  }
  return earliest;
}

/**
 * NARROW legacy-миграция (для скрипта migrate-global-prompt-socials): приводит к
 * плейсхолдеру `[socialNetworks]` ТОЛЬКО те имена сетей, что стоят в аудиторной
 * фразе старого авто-генератора — «...пользователи Facebook», «группа пользователей
 * Facebook», «...пользователи Facebook, Instagram и VK».
 *
 * В отличие от `normalizePlatformMentionsToPlaceholder` (граница СВЕЖЕГО вывода,
 * нормализует все положительные literal), эта функция действует как безопасное
 * миграционное правило над УЖЕ СОХРАНЁННЫМ произвольным текстом: сравнение
 * «Сравни Facebook с Telegram», инструкции «пиши для Facebook», отрицания
 * «не используй Facebook» кандидатами НЕ являются и не меняются.
 */
export function migrateLegacyGlobalPrompt(text: string): string {
  if (!text) return text;

  // Один проход: ищем аудиторный маркер «аудитори...» и сразу за ним (в окне)
  // триггер «пользовател...». Только такая связка — сигнатура старого шаблона
  // «Твоя целевая аудитория — ...пользователи Facebook». Произвольный текст с
  // «пользователи» без «аудитории» (сравнения, инструкции) кандидатом не стаёт.
  let out = text;
  let cursor = 0;
  while (cursor < out.length) {
    AUDIENCE_MARKER_RE.lastIndex = cursor;
    const marker = AUDIENCE_MARKER_RE.exec(out);
    if (!marker) break;
    const markerEnd = marker.index + marker[0].length;
    // Связка «аудитори... → пользовател...» должна быть В ОДНОМ ПРЕДЛОЖЕНИИ:
    // старая структура «Твоя целевая аудитория — ...пользователи Facebook» —
    // единый предлог. Если между маркером и триггером есть граница предложения
    // (. ; ! ? …,), связка рвётся и «пользователи» в СЛЕДУЮЩЕМ предложении
    // НЕ считается legacy-кандидатом (сравнения остаются нетронутыми).
    const sentenceEnd = findNextSentenceBoundary(out, markerEnd);
    const limit = sentenceEnd === -1 ? Math.min(out.length, markerEnd + 60) : Math.min(sentenceEnd + 1, markerEnd + 60);
    const afterMarker = out.slice(markerEnd, limit);
    AUDIENCE_NOUN_STEM_RE.lastIndex = 0;
    const trigger = AUDIENCE_NOUN_STEM_RE.exec(afterMarker);
    if (!trigger) {
      // Нет связки в том же предложении — двигаемся за конец маркера
      // (markerEnd уже включает сам маркер).
      cursor = markerEnd;
      continue;
    }
    const start = markerEnd + trigger.index;
    // Окно: от «пользовател...» до границы предложения, но не длиннее LEGACY_WINDOW.
    let end = -1;
    for (const sep of [';', '!', '?', '…', '.']) {
      const p = out.indexOf(sep, start + 1);
      if (p !== -1 && (end === -1 || p < end)) end = p;
    }
    if (end === -1) end = Math.min(out.length, start + LEGACY_WINDOW);
    else end = Math.min(end, start + LEGACY_WINDOW);

    const windowText = out.slice(start, end);
    let windowOut = windowText;
    for (const pat of LITERAL_NAME_PATTERNS) {
      windowOut = windowOut.replace(pat.re, (match: string, offset: number) => {
        if (isNegatedBefore(windowText, offset)) return match;
        return '[socialNetworks]';
      });
    }
    if (windowOut !== windowText) {
      out = out.slice(0, start) + windowOut + out.slice(end);
    }
    // Продолжаем сканирование после конца окна.
    cursor = start + windowOut.length;
  }
  return out;
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
