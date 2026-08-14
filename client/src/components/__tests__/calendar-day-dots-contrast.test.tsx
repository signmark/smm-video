/**
 * SM-22 (хвост): счётчик «+N» нечитаем на выбранном дне.
 *
 * Тестировщик: на выбранной дате (тёмно-синий фон `bg-primary`) цифра «+N»
 * сливается с фоном. Причина — счётчик задавал себе цвет сам
 * (`text-muted-foreground`), одинаковый для любого фона; точки видны, потому
 * что у них свои явные цвета.
 *
 * Проверяется две разные вещи, и обе нужны:
 *  1. контракт наследования — у счётчика нет собственного цвета, он берёт цвет
 *     дня (`text-current`); в jsdom Tailwind не разворачивается в реальные
 *     цвета, поэтому цвет здесь проверяется как контракт разметки;
 *  2. арифметика контраста по НАСТОЯЩИМ токенам темы из `client/src/index.css`:
 *     приглушённый цвет на фоне выбранного дня даёт нечитаемый контраст, а
 *     унаследованный — читаемый. Это и есть доказательство, что правка меняет
 *     видимое, а не только класс в разметке.
 *
 * Red-before: с `text-muted-foreground` падает пункт 1; пункт 2 остаётся
 * зелёным всегда — он описывает свойства темы, из-за которых пункт 1 важен.
 *
 * Что НЕ трогаем: сами токены темы. Белый на синем в тёмной теме даёт 3.6:1 —
 * это свойство кнопочных токенов приложения, а не этого счётчика; менять их
 * здесь означало бы редизайн темы под косметический дефект.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { CalendarDayDots, type CalendarDayDot } from '@/components/calendar-day-dots';

const makeDots = (n: number): CalendarDayDot[] =>
  Array.from({ length: n }, (_, i) => ({ key: `dot-${i}`, color: 'bg-blue-500' }));

// Ячейка выбранного дня из client/src/components/ui/calendar.tsx: day_selected =
// "bg-primary text-primary-foreground …". Оборачиваем ровно так же.
const renderInDay = (n: number, dayClass: string) =>
  render(
    <div className={dayClass}>
      <CalendarDayDots dots={makeDots(n)} />
    </div>,
  );

describe('SM-22: счётчик «+N» читается на выбранном дне', () => {
  it('счётчик не задаёт себе цвет, а наследует цвет дня', () => {
    renderInDay(17, 'bg-primary text-primary-foreground');
    const counter = screen.getByTestId('calendar-day-dots-overflow');

    expect(counter.className).not.toContain('text-muted-foreground');
    expect(counter.className).toContain('text-current');
    // Цвет не должен приезжать и в обход класса.
    expect(counter.getAttribute('style')).toBeNull();
  });

  it('на обычном дне разметка счётчика та же — цвет берётся от дня и там', () => {
    renderInDay(17, '');
    const counter = screen.getByTestId('calendar-day-dots-overflow');
    expect(counter.className).toContain('text-current');
  });

  it('правка косметическая: число и количество точек прежние', () => {
    renderInDay(17, 'bg-primary text-primary-foreground');
    // 17 публикаций: три точки + «+14» — предел MAX_VISIBLE_DOTS не изменился.
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(3);
    expect(screen.getByTestId('calendar-day-dots-overflow').textContent).toBe('+14');
  });
});

// ── контраст по настоящим токенам темы ──────────────────────────────────────

type RGB = [number, number, number];

function hslToRgb(h: number, s: number, l: number): RGB {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance([r, g, b]: RGB): number {
  const f = (u: number) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const css = fs.readFileSync(path.resolve(process.cwd(), 'client/src/index.css'), 'utf8');

// Токены темы объявлены как `--name: H S% L%;`. Светлая тема — первое вхождение
// (блок `:root`), тёмная — последнее (блок `.dark`).
function token(name: string, which: 'first' | 'last'): RGB {
  const re = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`, 'g');
  const all = [...css.matchAll(re)];
  expect(all.length, `токен --${name} не найден в index.css`).toBeGreaterThan(0);
  const m = which === 'first' ? all[0] : all[all.length - 1];
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

describe('SM-22: почему собственный цвет счётчика был дефектом', () => {
  for (const тема of ['first', 'last'] as const) {
    const имя = тема === 'first' ? 'светлая' : 'тёмная';

    it(`${имя} тема: приглушённый цвет на фоне выбранного дня нечитаем`, () => {
      const ratio = contrast(token('muted-foreground', тема), token('primary', тема));
      expect(ratio).toBeLessThan(3);
    });

    it(`${имя} тема: унаследованный цвет дня на том же фоне читается`, () => {
      const ratio = contrast(token('primary-foreground', тема), token('primary', тема));
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }

  it('на обычном дне унаследованный цвет тоже читается', () => {
    const ratio = contrast(token('foreground', 'first'), token('background', 'first'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
