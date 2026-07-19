import { describe, expect, it } from 'vitest';

import { toTelegramHtml } from '../utils/telegram-html';

/**
 * Инвариант: в выводе нет тегов, неподдерживаемых Telegram (parse_mode=HTML),
 * и нет «голых» & < > вне тегов — иначе Bot API отвечает
 * «Bad Request: can't parse entities».
 */
function expectTelegramSafe(output: string) {
  // Неподдерживаемые теги (по букве после <, чтобы не цеплять текст «5 < 10»)
  const unsupported = output.match(/<\/?[a-zA-Z][^>]*>/g) || [];
  const allowed = /^<\/?(?:b|i|u|s|code|pre|blockquote|tg-spoiler)>$|^<a href="[^"]*">$|^<\/a>$/;
  for (const tag of unsupported) {
    expect(tag, `неподдерживаемый тег ${tag}`).toMatch(allowed);
  }
}

describe('toTelegramHtml', () => {
  it('регрессия: экранированный HTML не воскрешает <p> после санитайзинга', () => {
    // Баг из продa: «Unsupported start tag "p" at byte offset 0»
    const output = toTelegramHtml('&lt;p&gt;Привет &lt;b&gt;мир&lt;/b&gt;&lt;/p&gt;');
    expect(output).toBe('Привет <b>мир</b>');
    expect(output.startsWith('<p>')).toBe(false);
    expectTelegramSafe(output);
  });

  it('раскручивает двойное экранирование (&amp;lt; → текст)', () => {
    expect(toTelegramHtml('&amp;lt;p&amp;gt;Текст&amp;lt;/p&amp;gt;')).toBe('Текст');
  });

  it('абзацы превращаются в пустую строку между блоками', () => {
    expect(toTelegramHtml('<p>Раз</p><p>Два</p>')).toBe('Раз\n\nДва');
  });

  it('заголовки становятся жирным текстом', () => {
    expect(toTelegramHtml('<h2>Заголовок</h2><p>текст</p>')).toBe('<b>Заголовок</b>\n\nтекст');
  });

  it('маркированный список → строки с «•»', () => {
    expect(toTelegramHtml('<ul><li>один</li><li>два</li></ul>')).toBe('• один\n• два');
  });

  it('нумерованный список → строки с номерами', () => {
    expect(toTelegramHtml('<ol><li>один</li><li>два</li><li>три</li></ol>'))
      .toBe('1. один\n2. два\n3. три');
  });

  it('<ul> не превращается в <u> (граница слова в нормализации тегов)', () => {
    const output = toTelegramHtml('<ul><li>пункт</li></ul>');
    expect(output).not.toContain('<u>');
    expect(output).not.toContain('</u>');
  });

  it('strong/em/del/ins конвертируются в b/i/s/u', () => {
    expect(toTelegramHtml('<strong>a</strong><em>b</em><del>c</del><ins>d</ins>'))
      .toBe('<b>a</b><i>b</i><s>c</s><u>d</u>');
  });

  it('blockquote сохраняется нативно, а не превращается в <b>', () => {
    expect(toTelegramHtml('<blockquote>цитата</blockquote>')).toBe('<blockquote>цитата</blockquote>');
  });

  it('ссылка нормализуется к <a href> и сохраняет закрывающий тег', () => {
    const output = toTelegramHtml('<a href="https://x.com" target="_blank">текст</a>');
    expect(output).toBe('<a href="https://x.com">текст</a>');
  });

  it('ссылка без href оставляет только текст', () => {
    expect(toTelegramHtml('<a name="anchor">якорь</a>')).toBe('якорь');
  });

  it('голые < > & в тексте экранируются, а не вырезаются', () => {
    const output = toTelegramHtml('5 < 10 & 20 > 3');
    expect(output).toBe('5 &lt; 10 &amp; 20 &gt; 3');
    expectTelegramSafe(output);
  });

  it('незакрытый тег закрывается в конце', () => {
    expect(toTelegramHtml('<b>жирный')).toBe('<b>жирный</b>');
  });

  it('перекрёстная вложенность исправляется', () => {
    expect(toTelegramHtml('<b><i>x</b>y</i>')).toBe('<b><i>x</i></b><i>y</i>');
  });

  it('лишний закрывающий тег вырезается', () => {
    expect(toTelegramHtml('текст</b>')).toBe('текст');
  });

  it('markdown конвертируется в HTML', () => {
    expect(toTelegramHtml('**жирный** и _курсив_')).toBe('<b>жирный</b> и <i>курсив</i>');
  });

  it('br и div превращаются в переносы строк', () => {
    expect(toTelegramHtml('<div>строка1<br>строка2</div>')).toBe('строка1\nстрока2');
  });

  it('таблица превращается в строки с ячейками', () => {
    expect(toTelegramHtml('<table><tr><td>а1</td><td>б1</td></tr><tr><td>а2</td><td>б2</td></tr></table>'))
      .toBe('а1 б1\nа2 б2');
  });

  it('tg-spoiler через span сохраняется', () => {
    expect(toTelegramHtml('<span class="tg-spoiler">секрет</span>')).toBe('<tg-spoiler>секрет</tg-spoiler>');
  });

  it('боевой кейс: экранированный пост со стилями, списком и ссылкой', () => {
    const output = toTelegramHtml(
      '&lt;p&gt;&lt;strong&gt;Заголовок поста&lt;/strong&gt;&lt;/p&gt;' +
      '&lt;p&gt;Текст с &amp;laquo;кавычками&amp;raquo; и списком:&lt;/p&gt;' +
      '&lt;ul&gt;&lt;li&gt;пункт 1&lt;/li&gt;&lt;li&gt;пункт 2&lt;/li&gt;&lt;/ul&gt;' +
      '&lt;p&gt;&lt;a href=&amp;quot;https://t.me/channel&amp;quot;&amp;gt;Ссылка&amp;lt;/a&amp;gt;&lt;/p&gt;',
    );
    expect(output).toBe(
      '<b>Заголовок поста</b>\n\n' +
      'Текст с «кавычками» и списком:\n\n' +
      '• пункт 1\n• пункт 2\n\n' +
      '<a href="https://t.me/channel">Ссылка</a>',
    );
    expectTelegramSafe(output);
  });

  it('пустой и невалидный ввод', () => {
    expect(toTelegramHtml('')).toBe('');
    expect(toTelegramHtml(null as any)).toBe('');
    expect(toTelegramHtml(undefined as any)).toBe('');
  });
});
