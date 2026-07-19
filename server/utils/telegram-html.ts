/**
 * Приводит произвольный HTML/Markdown к подмножеству, которое принимает
 * Telegram Bot API (parse_mode=HTML): <b>, <i>, <u>, <s>, <code>, <pre>,
 * <a href>, <blockquote>, <tg-spoiler>.
 *
 * Неподдерживаемые теги не просто вырезаются, а переформатируются в визуально
 * похожий вид:
 *   <p>, <div>          → переносы строк (абзацы)
 *   <h1>–<h6>           → <b>заголовок</b> + пустая строка
 *   <ul>/<li>           → строки «• пункт»
 *   <ol>/<li>           → нумерованные строки «1. пункт»
 *   <table>/<tr>        → строки с ячейками через пробел
 *   <strong>/<em>/<del> → <b>/<i>/<s> и т.д.
 *
 * Порядок конвейера важен:
 *   1. Декодируем HTML-сущности ПЕРВЫМ делом (в т.ч. двойное экранирование
 *      вида &amp;lt;), иначе теги «воскресают» после вырезания — именно это
 *      вызывало «Unsupported start tag "p" at byte offset 0».
 *   2. Конвертируем разметку.
 *   3. Вырезаем всё, кроме поддерживаемых тегов.
 *   4. Экранируем &, <, > в тексте вне тегов — Telegram требует этого.
 *   5. Балансируем теги (закрываем незакрытые, чиним перекрёстную вложенность).
 */

import { markdownToTelegramHtml } from './strip-markdown';

const ALLOWED_INLINE = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler'] as const;

const ALLOWED_TAG_PATTERN =
  /<\/?(?:b|i|u|s|code|pre|blockquote|tg-spoiler)>|<\/a>|<a href="[^"]*">/gi;

function decodeHtmlEntities(input: string): string {
  let text = input;
  // Несколько проходов для двойного/тройного экранирования (&amp;lt; → &lt; → <)
  for (let pass = 0; pass < 3; pass++) {
    const decoded = text
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, ' ')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&hellip;/gi, '…')
      .replace(/&laquo;/gi, '«')
      .replace(/&raquo;/gi, '»')
      .replace(/&#(\d+);/g, (_, code) => {
        const cp = Number(code);
        return Number.isSafeInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
          ? String.fromCodePoint(cp)
          : _;
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const cp = parseInt(hex, 16);
        return Number.isSafeInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
          ? String.fromCodePoint(cp)
          : _;
      })
      // &amp; — ПОСЛЕДНИМ, чтобы не развернуть &amp;lt; раньше времени
      .replace(/&amp;/gi, '&');
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

/**
 * Содержимое <pre>/<code> — это литеральный текст, а не разметка: конвейер
 * не должен ни декодировать/конвертировать его, ни съедать в нём теги.
 * Блоки вырезаются в плейсхолдеры ПОСЛЕ decodeHtmlEntities (единая нормализация
 * сущностей) и возвращаются в конце конвейера с однократным экранированием & < >.
 */
interface CodeBlockStash {
  kind: 'pre' | 'code';
  content: string;
}

function extractCodeBlocks(text: string): { text: string; blocks: CodeBlockStash[] } {
  const blocks: CodeBlockStash[] = [];
  const stash = (kind: 'pre' | 'code') => (_m: string, content: string) => {
    const index = blocks.push({ kind, content }) - 1;
    return `\x00CB${index}\x00`;
  };
  // $ (без флага m) — конец строки: ловит и незакрытые блоки
  const extracted = text
    .replace(/<pre[^>]*>([\s\S]*?)(?:<\/pre>|$)/gi, stash('pre'))
    .replace(/<code[^>]*>([\s\S]*?)(?:<\/code>|$)/gi, stash('code'));
  return { text: extracted, blocks };
}

function restoreCodeBlocks(text: string, blocks: CodeBlockStash[]): string {
  return text.replace(/\x00CB(\d+)\x00/g, (match, indexRaw: string) => {
    const block = blocks[Number(indexRaw)];
    if (!block) return match;
    const escaped = block.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim();
    return `<${block.kind}>${escaped}</${block.kind}>`;
  });
}

function convertOrderedLists(text: string): string {
  return text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, body: string) => {
    let index = 0;
    const items = body.replace(/<li[^>]*>([\s\S]*?)(?:<\/li>|(?=<li)|$)/gi, (_m, item: string) => {
      index += 1;
      const trimmed = item.trim();
      return trimmed ? `${index}. ${trimmed}\n` : '';
    });
    return `\n${items}\n`;
  });
}

function convertUnorderedLists(text: string): string {
  return text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, body: string) => {
    const items = body.replace(/<li[^>]*>([\s\S]*?)(?:<\/li>|(?=<li)|$)/gi, (_m, item: string) => {
      const trimmed = item.trim();
      return trimmed ? `• ${trimmed}\n` : '';
    });
    return `\n${items}\n`;
  });
}

function convertMarkup(text: string): string {
  return text
    // Переносы строк
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n\n')
    // Заголовки → жирный текст
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner) => `<b>${inner.trim()}</b>\n\n`)
    // Абзацы и контейнеры → переносы строк
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `${inner.trim()}\n\n`)
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n')
    .replace(/<(?:article|section|aside|header|footer|nav|main|figure|figcaption)[^>]*>([\s\S]*?)<\/(?:article|section|aside|header|footer|nav|main|figure|figcaption)>/gi, '$1\n')
    // Таблицы → строки
    .replace(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi, '$1 ')
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, inner) => `${inner.trim()}\n`)
    .replace(/<(?:table|thead|tbody|tfoot)[^>]*>([\s\S]*?)<\/(?:table|thead|tbody|tfoot)>/gi, '$1\n')
    // Инлайн-форматирование → поддерживаемые теги
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>')
    .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '<u>$1</u>')
    .replace(/<(?:strike|del)[^>]*>([\s\S]*?)<\/(?:strike|del)>/gi, '<s>$1</s>')
    .replace(/<span[^>]*class=["'][^"']*tg-spoiler[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '<tg-spoiler>$1</tg-spoiler>')
    // Нормализация поддерживаемых тегов (убираем атрибуты).
    // Граница (?=[\s>]) обязательна: иначе <ul> превратится в <u>, <blockquote> — в <b>.
    .replace(/<(b|i|u|s|code|pre|blockquote|tg-spoiler)(?=[\s>])[^>]*>/gi, '<$1>')
    // Спойлеры-альтернативы
    .replace(/<spoiler[^>]*>([\s\S]*?)<\/spoiler>/gi, '<tg-spoiler>$1</tg-spoiler>')
    // Ссылки → <a href="...">текст</a>; без href — просто текст.
    // Второй регекс не должен трогать уже нормализованные ссылки с href.
    .replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '<a href="$1">$2</a>')
    .replace(/<a(?![^>]*\bhref=)[^>]*>([\s\S]*?)<\/a>/gi, '$1');
}

function stripDisallowedTags(text: string): string {
  // Тег — это только <буква...>: «5 < 10 и 20 > 3» остаётся текстом и будет экранировано.
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => {
    ALLOWED_TAG_PATTERN.lastIndex = 0;
    return ALLOWED_TAG_PATTERN.test(tag) ? tag : '';
  });
}

function escapeTextOutsideTags(text: string): string {
  const parts = text.split(/(<\/?(?:b|i|u|s|code|pre|blockquote|tg-spoiler)>|<\/a>|<a href="[^"]*">)/gi);
  return parts
    .map((part, index) => {
      // Нечётные индексы — захваченные теги, их не трогаем
      if (index % 2 === 1) return part;
      return part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    })
    .join('');
}

function escapeHrefQuotes(text: string): string {
  return text.replace(/<a href="([^"]*)">/gi, (_, url: string) => {
    const safe = url.replace(/&/g, '&amp;').replace(/</g, '').replace(/>/g, '');
    return `<a href="${safe}">`;
  });
}

/**
 * Закрывает незакрытые теги, вырезает лишние закрывающие и чинит
 * перекрёстную вложенность (<b><i>x</b></i> → <b><i>x</i></b><i></i> без
 * пустого хвоста — переоткрываем только если после него есть текст).
 */
function balanceTags(text: string): string {
  const tagPattern = /<(a href="[^"]*"|\/(?:b|i|u|s|code|pre|a|blockquote|tg-spoiler)|(?:b|i|u|s|code|pre|blockquote|tg-spoiler))>/gi;
  const stack: Array<{ name: string; raw: string }> = [];
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    result += text.slice(lastIndex, match.index);
    lastIndex = tagPattern.lastIndex;
    const inner = match[1];

    if (inner.startsWith('/')) {
      const name = inner.slice(1).toLowerCase();
      const idx = stack.map(t => t.name).lastIndexOf(name);
      if (idx === -1) continue; // закрывающий без открывающего — вырезаем
      const above = stack.splice(idx + 1);
      for (let i = above.length - 1; i >= 0; i--) result += `</${above[i].name}>`;
      result += `</${name}>`;
      stack.pop();
      for (const t of above) {
        result += t.raw;
        stack.push(t);
      }
    } else {
      const name = inner.startsWith('a ') ? 'a' : inner.toLowerCase();
      stack.push({ name, raw: match[0] });
      result += match[0];
    }
  }
  result += text.slice(lastIndex);
  for (let i = stack.length - 1; i >= 0; i--) result += `</${stack[i].name}>`;
  return result;
}

function cleanupWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Убирает опустевшие парные теги (<b></b>), которые могли остаться после конвертации. */
function dropEmptyTags(text: string): string {
  let previous: string;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<(b|i|u|s|code|pre|blockquote|tg-spoiler)>\s*<\/\1>/gi, '');
  } while (current !== previous);
  return current;
}

/**
 * Конвертирует текст (HTML и/или Markdown, возможно с экранированными
 * сущностями) в безопасный HTML для Telegram parse_mode=HTML.
 */
export function toTelegramHtml(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  let text = decodeHtmlEntities(raw);
  // pre/code — литеральный текст: изолируем от markdown- и HTML-конвертаций
  const stash = extractCodeBlocks(text);
  text = stash.text;
  text = markdownToTelegramHtml(text);
  text = convertMarkup(text);
  text = convertOrderedLists(text);
  text = convertUnorderedLists(text);
  // Оставшиеся одиночные <li> (вне ul/ol) — как маркированный пункт
  text = text.replace(/<li[^>]*>([\s\S]*?)(?:<\/li>|$)/gi, (_m, item: string) => {
    const trimmed = item.trim();
    return trimmed ? `\n• ${trimmed}` : '';
  });
  text = stripDisallowedTags(text);
  text = balanceTags(text);
  text = dropEmptyTags(text);
  text = escapeTextOutsideTags(text);
  text = escapeHrefQuotes(text);
  text = cleanupWhitespace(text);
  // Возвращаем код-блоки последними: escape/cleanup их содержимое уже не тронут
  text = restoreCodeBlocks(text, stash.blocks);
  return text;
}

/** Список поддерживаемых тегов — для внешних валидаторов. */
export const TELEGRAM_ALLOWED_TAGS = ALLOWED_INLINE;
