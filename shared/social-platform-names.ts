/**
 * Единственный источник правды о том, КАК в свободном тексте промта опознаётся
 * упоминание соцсети (SM-18).
 *
 * Здесь лежат три вещи, которые обязаны совпадать на сервере и на клиенте:
 *  1. список литеральных названий (вместе с алиасами вроде `VK`);
 *  2. слова-отрицания;
 *  3. правило соседства: отрицание действует только внутри своего предложения
 *     и только на ближайшие несколько слов.
 *
 * Почему в `shared/`, а не копией на каждой стороне. Сервер подставляет
 * `[socialNetworks]` вместо литеральных названий, клиент по тем же названиям
 * предупреждает, что упомянутая сеть не подключена. Пока списки лежали в двух
 * местах, они разошлись молча: серверный знал `TikTok` и алиас `VK`, клиентский
 * не знал ни того, ни другого, и предупреждение просто не появлялось. Копию
 * нельзя удержать в синхроне обещанием — её удерживает только отсутствие копии.
 *
 * Файл намеренно без зависимостей: его импортируют и браузерный бандл, и сервер.
 */

/** Идентификаторы платформ ровно в том виде, в каком они лежат в настройках. */
export type PlatformKey =
  | 'instagram'
  | 'telegram'
  | 'vk'
  | 'facebook'
  | 'youtube'
  | 'tiktok'
  | 'threads';

/**
 * Литеральные написания, по которым сеть считается упомянутой.
 *
 * У одной платформы их может быть несколько (`ВКонтакте` и `VK`), поэтому это
 * список пар, а не словарь: словарь «платформа → одно имя» как раз и потерял
 * алиас `VK` в прошлой версии.
 *
 * Порядок важен только для читаемости; поиск идёт по всем записям.
 */
export const PLATFORM_LITERAL_NAMES: ReadonlyArray<{ key: PlatformKey; name: string }> = [
  { key: 'instagram', name: 'Instagram' },
  { key: 'telegram', name: 'Telegram' },
  { key: 'vk', name: 'ВКонтакте' },
  { key: 'vk', name: 'VK' },
  { key: 'facebook', name: 'Facebook' },
  { key: 'youtube', name: 'YouTube' },
  { key: 'tiktok', name: 'TikTok' },
  { key: 'threads', name: 'Threads' },
];

/**
 * Слова-отрицания, после которых упоминание сети — это инструкция «не делай»,
 * а не просьба публиковать туда. Ни подставлять плейсхолдер, ни предупреждать
 * в таком контексте нельзя: смысл фразы инвертируется.
 */
export const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  'не', 'но', 'без', 'кроме', 'избегай', 'избегать', 'избегайте',
  'нельзя', 'запрещено', 'запрещается', 'не пиши', 'не используй',
  'не используем', 'не упоминай', 'не надо', 'не нужно', 'исключая',
  "don't", 'not', 'against', 'avoid',
]);

/** Сколько символов назад от упоминания вообще имеет смысл смотреть. */
const CONTEXT_WINDOW = 50;

/** Сколько ближайших слов перед упоминанием проверяются на отрицание. */
const NEGATION_LOOKBEHIND_TOKENS = 4;

/**
 * Регэксп «целое слово» без опоры на ASCII-\b: `\b` не работает по границе
 * кириллицы, и `ВКонтакте` либо не находилось, либо находилось внутри другого
 * слова. Здесь граница задана явно через отсутствие буквы или цифры по бокам.
 */
export function wholeWordRegex(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Есть ли отрицание непосредственно перед позицией `matchIndex`.
 *
 * Считается только внутри текущего предложения: точка, `;`, `!`, `?`, многоточие
 * и перенос строки обрывают действие отрицания. Иначе «Не используй Facebook.
 * Пиши в Telegram» пометило бы отрицательным и Telegram.
 */
export function isNegatedBefore(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - CONTEXT_WINDOW);
  const before = text.slice(start, matchIndex);
  const breakAt = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf(';'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
    before.lastIndexOf('…'),
    before.lastIndexOf('\n'),
  );
  const window = breakAt >= 0 ? before.slice(breakAt + 1) : before;
  const tokens = window
    .toLowerCase()
    .split(/[\s,;.!?…():«»"/]+/)
    .filter((t) => t.length > 0);
  return tokens.slice(-NEGATION_LOOKBEHIND_TOKENS).some((t) => NEGATION_TOKENS.has(t));
}

/**
 * Все упоминания сетей в тексте, БЕЗ отрицающего контекста.
 *
 * Возвращает уникальные ключи платформ. Проверяется каждое вхождение, а не
 * первое: «Не используй Facebook. Пиши в Facebook» — это положительное
 * упоминание, и молчать здесь нельзя.
 */
export function findPositivePlatformMentions(text: string): PlatformKey[] {
  if (!text) return [];
  const found = new Set<PlatformKey>();
  for (const { key, name } of PLATFORM_LITERAL_NAMES) {
    if (found.has(key)) continue;
    const re = wholeWordRegex(name);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!isNegatedBefore(text, m.index)) {
        found.add(key);
        break;
      }
    }
  }
  return PLATFORM_LITERAL_NAMES.filter((p) => found.has(p.key))
    .map((p) => p.key)
    .filter((key, i, arr) => arr.indexOf(key) === i);
}
