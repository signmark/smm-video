/**
 * SM-22, повторно: ограничение маркеров дня было только в одном календаре.
 *
 * Тестировщик прислал HTML ячейки с семнадцатью точками подряд. Разметка в нём
 * совпадала с `client/src/pages/posts/index.tsx`, а правка от 08.08 ушла в
 * `client/src/components/PublicationCalendar.tsx`. То есть закрыт был один
 * экран, а смотрели на другой.
 *
 * Проверяется не то, что «функция вернула массив», а то, что оба календаря
 * зовут одну и ту же отрисовку и день с семнадцатью публикациями даёт четыре
 * точки и индикатор остатка.
 *
 * Red-before: до правки в pages/posts/index.tsx нет ни импорта общего
 * компонента, ни ограничения — падают тесты про исходники обоих экранов;
 * до вынесения общей функции падает и проверка на четыре маркера.
 *
 * Разметка собирается через `createElement`, а не JSX: в этом репозитории
 * vitest сконфигурирован без react-плагина, и JSX прямо в тесте не парсится.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import {
  CalendarDayDots,
  splitDayDots,
  MAX_VISIBLE_DOTS,
  type CalendarDayDot,
} from '@/components/calendar-day-dots';

const makeDots = (n: number): CalendarDayDot[] =>
  Array.from({ length: n }, (_, i) => ({ key: `dot-${i}`, color: 'bg-blue-500' }));

const renderDots = (dots: CalendarDayDot[]) =>
  render(createElement(CalendarDayDots, { dots }));

const readSource = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../../..', relative), 'utf-8');

describe('SM-22: маркеры дня ограничены четырьмя', () => {
  it('день с 17 публикациями даёт ровно 4 точки и индикатор +13', () => {
    renderDots(makeDots(17));
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(4);
    expect(screen.getByTestId('calendar-day-dots-overflow').textContent).toBe('+13');
  });

  it('день с 3 публикациями даёт три точки и не даёт индикатора', () => {
    renderDots(makeDots(3));
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(3);
    expect(screen.queryByTestId('calendar-day-dots-overflow')).toBeNull();
  });

  it('ровно 4 публикации — граница: четыре точки, индикатора нет', () => {
    renderDots(makeDots(MAX_VISIBLE_DOTS));
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(4);
    expect(screen.queryByTestId('calendar-day-dots-overflow')).toBeNull();
  });

  it('пустой день не рисует контейнер вовсе', () => {
    const { container } = renderDots([]);
    expect(container.firstChild).toBeNull();
  });

  it('содержимое не выпадает из ячейки: обрезка и предел ширины на контейнере', () => {
    renderDots(makeDots(17));
    const box = screen.getByTestId('calendar-day-dots');
    expect(box.className).toContain('overflow-hidden');
    expect(box.className).toContain('max-w-full');
  });

  it('неуспешные попытки входят в общий счёт, а не рисуются сверх предела', () => {
    renderDots([
      ...makeDots(3),
      { key: 'failed-1', color: 'bg-red-500' },
      { key: 'failed-2', color: 'bg-red-500' },
      { key: 'failed-3', color: 'bg-red-500' },
    ]);
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(4);
    expect(screen.getByTestId('calendar-day-dots-overflow').textContent).toBe('+2');
  });

  it('splitDayDots считает остаток без рендера', () => {
    expect(splitDayDots(makeDots(17)).remaining).toBe(13);
    expect(splitDayDots(makeDots(4)).remaining).toBe(0);
    expect(splitDayDots(makeDots(1)).visible).toHaveLength(1);
  });
});

describe('SM-22: оба календаря используют одну отрисовку', () => {
  const SHARED = 'calendar-day-dots';
  const SCREENS = [
    'client/src/pages/posts/index.tsx',
    'client/src/components/PublicationCalendar.tsx',
  ];

  it('pages/posts/index.tsx рисует маркеры общим компонентом', () => {
    const src = readSource(SCREENS[0]);
    expect(src).toContain(SHARED);
    expect(src).toContain('<CalendarDayDots');
  });

  it('PublicationCalendar.tsx рисует маркеры тем же компонентом', () => {
    const src = readSource(SCREENS[1]);
    expect(src).toContain(SHARED);
    expect(src).toContain('<CalendarDayDots');
  });

  it('ни один календарь не рисует точки в обход общего компонента', () => {
    for (const file of SCREENS) {
      // Разметка точки — `h-1.5 w-1.5 rounded-full` — должна остаться
      // единственной, внутри общего компонента.
      expect(readSource(file)).not.toContain('h-1.5 w-1.5 rounded-full');
    }
  });
});
