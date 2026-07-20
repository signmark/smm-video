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

  describe('pre/code — литеральный текст, а не разметка', () => {
    it('экранированный HTML внутри <pre> сохраняется дословно', () => {
      // Регрессия (Task 1 из review-follow-ups): конвейер съедал <div> внутри pre
      const output = toTelegramHtml('<pre>&lt;div&gt;hi&lt;/div&gt;</pre>');
      expect(output).toBe('<pre>&lt;div&gt;hi&lt;/div&gt;</pre>');
    });

    it('<code> сохраняет операторы сравнения экранированными', () => {
      expect(toTelegramHtml('<code>if (a &lt; b) { x(); }</code>'))
        .toBe('<code>if (a &lt; b) { x(); }</code>');
    });

    it('настоящие теги внутри <pre> превращаются в литеральный текст', () => {
      expect(toTelegramHtml('<pre><b>not bold</b></pre>'))
        .toBe('<pre>&lt;b&gt;not bold&lt;/b&gt;</pre>');
    });

    it('переносы строк внутри <pre> не схлопываются', () => {
      expect(toTelegramHtml('<pre>line1\n\n\nline2</pre>'))
        .toBe('<pre>line1\n\n\nline2</pre>');
    });

    it('markdown внутри <code> не конвертируется', () => {
      expect(toTelegramHtml('<code>**не жирный**</code>'))
        .toBe('<code>**не жирный**</code>');
    });

    it('незакрытый <pre> закрывается, содержимое экранируется', () => {
      expect(toTelegramHtml('текст <pre>a < b')).toBe('текст <pre>a &lt; b</pre>');
    });

    it('код-блоки соседствуют с обычной разметкой', () => {
      expect(toTelegramHtml('<p>абзац</p><pre>код &lt;tag&gt;</pre><p><b>ещё</b></p>'))
        .toBe('абзац\n\n<pre>код &lt;tag&gt;</pre><b>ещё</b>');
    });

    it('содержимое <pre> не экранируется дважды', () => {
      const output = toTelegramHtml('<pre>5 &lt; 10</pre>');
      expect(output).toBe('<pre>5 &lt; 10</pre>');
      expect(output).not.toContain('&amp;lt;');
    });
  });

  describe('очистка мусора', () => {
    it('zero-width символы и BOM удаляются', () => {
      expect(toTelegramHtml('текст​с‌невидимыми‍символами﻿'))
        .toBe('текстсневидимымисимволами');
    });

    it('пустые ссылки вычищаются', () => {
      expect(toTelegramHtml('<a href="https://x.com"></a>видимый текст'))
        .toBe('видимый текст');
    });
  });

  describe('числовые сущности', () => {
    it('hex-сущности декодируются', () => {
      expect(toTelegramHtml('it&#x27;s &#x2014; fine')).toBe("it's — fine");
    });

    it('двойное экранирование hex (&amp;#x27;) декодируется за два прохода', () => {
      expect(toTelegramHtml('it&amp;#x27;s')).toBe("it's");
    });

    it('десятичные сущности декодируются', () => {
      expect(toTelegramHtml('&#1047;&#1076;&#1088;&#1072;&#1074;&#1089;&#1090;&#1074;&#1091;&#1081;'))
        .toBe('Здравствуй');
    });

    it('невалидные code point (суррогаты) не декодируются', () => {
      expect(toTelegramHtml('&#xD800;')).toBe('&amp;#xD800;');
    });
  });
});
