/**
 * Unit-тесты генерации ASS-субтитров.
 *
 * Чистые тесты — без сети, без ffmpeg, без API-расходов.
 * Запуск (из video-app/):
 *   npx tsx --test tests/subtitle-ass-output.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSubtitleASS } from '../server/services/video-assembler.js';
import type { KaraokeSceneEntry } from '../server/services/video-assembler.js';

// ── Тестовые данные ────────────────────────────────────────────────────────────

const SCENES: KaraokeSceneEntry[] = [
  { narration: 'Первая сцена о природе',  text: 'Природа',   startTime: 0,    duration: 5 },
  { narration: 'Вторая сцена о жизни',    text: 'Жизнь',     startTime: 5,    duration: 4 },
  { narration: '',                         text: 'Пусто',     startTime: 9,    duration: 3 },
  { narration: 'Третья финальная сцена',  text: 'Финал',     startTime: 12,   duration: 6 },
];

const FORMATS = ['9:16', '16:9', '1:1'] as const;

// ── Утилиты ───────────────────────────────────────────────────────────────────

function parseDialogues(ass: string): string[] {
  return ass.split('\n').filter(l => l.startsWith('Dialogue:'));
}

function parseStyles(ass: string): string[] {
  return ass.split('\n').filter(l => l.startsWith('Style:'));
}

// ══════════════════════════════════════════════════════════════════════════════
// fade-zoom — основные проверки
// ══════════════════════════════════════════════════════════════════════════════

describe('Стиль fade-zoom — ASS-генерация', () => {
  const ass = generateSubtitleASS(SCENES, '9:16', 'fade-zoom');

  test('возвращает непустую строку', () => {
    assert.ok(typeof ass === 'string' && ass.length > 0, 'ASS пустой');
  });

  test('содержит заголовок [Script Info]', () => {
    assert.ok(ass.includes('[Script Info]'), 'Нет блока [Script Info]');
  });

  test('стиль называется FadeZoom', () => {
    const styles = parseStyles(ass);
    assert.ok(styles.length > 0, 'Нет строк Style:');
    assert.ok(styles[0].includes('FadeZoom'), `Имя стиля не FadeZoom: "${styles[0]}"`);
  });

  test('содержит fade-тег \\fad(300,300)', () => {
    assert.ok(ass.includes('\\fad(300,300)'), 'Нет тега \\fad(300,300) в ASS');
  });

  test('содержит начальный масштаб \\fscx95\\fscy95', () => {
    assert.ok(
      ass.includes('\\fscx95') && ass.includes('\\fscy95'),
      'Нет начального scale 95% в ASS',
    );
  });

  test('содержит zoom-анимацию \\t(0,500,...)', () => {
    assert.ok(ass.includes('\\t(0,500,'), 'Нет zoom-анимации \\t(0,500,...) в ASS');
  });

  test('содержит финальный масштаб \\fscx100\\fscy100', () => {
    assert.ok(
      ass.includes('\\fscx100') && ass.includes('\\fscy100'),
      'Нет финального scale 100% в ASS',
    );
  });

  test('фильтрует сцены с пустым narration', () => {
    const dialogues = parseDialogues(ass);
    // Сцена с пустым narration ('Пусто') не должна попасть в Dialogue
    for (const d of dialogues) {
      assert.ok(!d.includes('Пусто'), `Пустая сцена попала в Dialogue: "${d}"`);
    }
    // Должны быть ровно 3 диалога (из 4 сцен одна пустая)
    assert.equal(dialogues.length, 3, `Ожидалось 3 диалога, получено ${dialogues.length}`);
  });

  test('тексты сцен присутствуют в диалогах', () => {
    assert.ok(ass.includes('Первая сцена о природе'), 'Нет narration первой сцены');
    assert.ok(ass.includes('Вторая сцена о жизни'),   'Нет narration второй сцены');
    assert.ok(ass.includes('Третья финальная сцена'), 'Нет narration третьей сцены');
  });

  test('временны́е метки первой сцены: 0:00:00.00 → 0:00:05.00', () => {
    const dialogues = parseDialogues(ass);
    const first = dialogues[0];
    assert.ok(first.includes('0:00:00.00'), `Нет startTime 0:00:00.00 в "${first}"`);
    assert.ok(first.includes('0:00:05.00'), `Нет endTime 0:00:05.00 в "${first}"`);
  });

  test('временны́е метки второй сцены: 0:00:05.00 → 0:00:09.00', () => {
    const dialogues = parseDialogues(ass);
    const second = dialogues[1];
    assert.ok(second.includes('0:00:05.00'), `Нет startTime 0:00:05.00 в "${second}"`);
    assert.ok(second.includes('0:00:09.00'), `Нет endTime 0:00:09.00 в "${second}"`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// fade-zoom — форматы
// ══════════════════════════════════════════════════════════════════════════════

describe('Стиль fade-zoom — все форматы', () => {
  for (const fmt of FORMATS) {
    test(`формат ${fmt} — генерирует корректный ASS`, () => {
      const out = generateSubtitleASS(SCENES, fmt, 'fade-zoom');
      assert.ok(out.includes('FadeZoom'),       `${fmt}: нет стиля FadeZoom`);
      assert.ok(out.includes('\\fad(300,300)'), `${fmt}: нет \\fad(300,300)`);
      assert.ok(out.includes('\\fscx95'),       `${fmt}: нет \\fscx95`);
      assert.ok(out.includes('\\t(0,500,'),     `${fmt}: нет zoom-анимации`);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// fade-zoom vs fade — сравнение
// ══════════════════════════════════════════════════════════════════════════════

describe('Стиль fade-zoom отличается от fade', () => {
  const fadAss     = generateSubtitleASS(SCENES, '9:16', 'fade');
  const fadeZoomAss = generateSubtitleASS(SCENES, '9:16', 'fade-zoom');

  test('fade не содержит \\fscx (нет масштаба)', () => {
    assert.ok(!fadAss.includes('\\fscx'), 'fade не должен содержать \\fscx');
  });

  test('fade-zoom содержит \\fscx (есть масштаб)', () => {
    assert.ok(fadeZoomAss.includes('\\fscx'), 'fade-zoom должен содержать \\fscx');
  });

  test('fade использует \\fad(350,350), fade-zoom — \\fad(300,300)', () => {
    assert.ok(fadAss.includes('\\fad(350,350)'),     'fade: ожидался \\fad(350,350)');
    assert.ok(fadeZoomAss.includes('\\fad(300,300)'), 'fade-zoom: ожидался \\fad(300,300)');
  });

  test('стили называются по-разному: Fade vs FadeZoom', () => {
    const fadeStyles     = parseStyles(fadAss);
    const fadeZoomStyles = parseStyles(fadeZoomAss);
    assert.ok(fadeStyles[0].includes('Fade,'),     `fade style: ожидался "Fade,", получен "${fadeStyles[0]}"`);
    assert.ok(fadeZoomStyles[0].includes('FadeZoom,'), `fade-zoom style: ожидался "FadeZoom,", получен "${fadeZoomStyles[0]}"`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// fade-zoom — опции (цвет, шрифт, размер)
// ══════════════════════════════════════════════════════════════════════════════

describe('Стиль fade-zoom — опции субтитров', () => {
  test('опция color меняет цвет в стиле', () => {
    const out = generateSubtitleASS(SCENES, '9:16', 'fade-zoom', { color: '#ffff00' });
    // Жёлтый в ASS BGR = 0000FFFF
    assert.ok(out.includes('00FFFF'), `Цвет #ffff00 не применился. ASS фрагмент: "${out.slice(0, 500)}"`);
  });

  test('опция font меняет шрифт в стиле', () => {
    const out = generateSubtitleASS(SCENES, '9:16', 'fade-zoom', { font: 'Arial' });
    assert.ok(out.includes('Arial'), 'Шрифт Arial не попал в стиль');
  });

  test('sizeMultiplier=2 увеличивает fontSize', () => {
    const normal = generateSubtitleASS(SCENES, '9:16', 'fade-zoom', { sizeMultiplier: 1 });
    const large  = generateSubtitleASS(SCENES, '9:16', 'fade-zoom', { sizeMultiplier: 2 });
    const sizeNormal = parseInt(parseStyles(normal)[0].split(',')[2]);
    const sizeLarge  = parseInt(parseStyles(large)[0].split(',')[2]);
    assert.ok(sizeLarge > sizeNormal,
      `sizeMultiplier=2 не увеличил размер: normal=${sizeNormal}, large=${sizeLarge}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Граничные случаи
// ══════════════════════════════════════════════════════════════════════════════

describe('Стиль fade-zoom — граничные случаи', () => {
  test('пустой массив сцен → валидный ASS без диалогов', () => {
    const out = generateSubtitleASS([], '9:16', 'fade-zoom');
    assert.ok(out.includes('[Script Info]'), 'Нет заголовка при пустом массиве');
    assert.equal(parseDialogues(out).length, 0, 'Диалогов быть не должно');
  });

  test('все сцены с пустым narration → 0 диалогов', () => {
    const empty: KaraokeSceneEntry[] = [
      { narration: '',  text: 'A', startTime: 0, duration: 3 },
      { narration: '   ', text: 'B', startTime: 3, duration: 3 },
    ];
    const out = generateSubtitleASS(empty, '9:16', 'fade-zoom');
    assert.equal(parseDialogues(out).length, 0, 'При пустых narration не должно быть диалогов');
  });

  test('одна сцена → ровно один диалог', () => {
    const single: KaraokeSceneEntry[] = [
      { narration: 'Единственная сцена', text: 'Одна', startTime: 0, duration: 10 },
    ];
    const out = generateSubtitleASS(single, '9:16', 'fade-zoom');
    assert.equal(parseDialogues(out).length, 1, 'Должен быть ровно 1 диалог');
  });
});
