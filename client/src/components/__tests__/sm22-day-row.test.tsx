/**
 * SM-22, регрессия центрирования: счётчик +N растягивал ячейку дня.
 *
 * Тестировщик замерил в DevTools: кнопка дня осталась 36x36, а внутренний блок
 * вырос до 39px. Причина — счётчик лежал в том же flex-wrap, что и точки, по
 * ширине не помещался и переносился на вторую строку.
 *
 * Честно про метод: jsdom не считает раскладку, реальные 36 против 39 пикселей
 * здесь измерить нечем. Поэтому проверяется то, из чего эта высота получается:
 * ряд маркеров — одна строка без переноса, с явно заданной высотой, и число
 * элементов в нём не растёт от того, что публикаций стало больше.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarDayDots, splitDayDots, MAX_VISIBLE_DOTS, type CalendarDayDot } from '@/components/calendar-day-dots';

const makeDots = (n: number): CalendarDayDot[] =>
  Array.from({ length: n }, (_, i) => ({ key: `dot-${i}`, color: 'bg-blue-500' }));

const row = (n: number) => {
  render(<CalendarDayDots dots={makeDots(n)} />);
  return screen.getByTestId('calendar-day-dots');
};

describe('SM-22: ряд маркеров дня не растягивает ячейку', () => {
  it('ряд не переносится', () => {
    const box = row(17);
    expect(box.className).toContain('flex-nowrap');
    expect(box.className).not.toContain('flex-wrap');
  });

  it('высота ряда задана явно', () => {
    expect(row(17).className).toContain('h-2');
  });

  it('счётчик лежит в том же ряду, а не отдельной строкой под точками', () => {
    render(<CalendarDayDots dots={makeDots(17)} />);
    const box = screen.getByTestId('calendar-day-dots');
    expect(screen.getByTestId('calendar-day-dots-overflow').parentElement).toBe(box);
  });

  it('число элементов ряда не превышает четырёх ни при +1, ни при +11', () => {
    const { container: одна } = render(<CalendarDayDots dots={makeDots(MAX_VISIBLE_DOTS + 1)} />);
    const { container: много } = render(<CalendarDayDots dots={makeDots(MAX_VISIBLE_DOTS + 11)} />);
    const детей = (c: HTMLElement) => c.querySelector('[data-testid="calendar-day-dots"]')!.children.length;
    expect(детей(одна)).toBe(MAX_VISIBLE_DOTS);
    expect(детей(много)).toBe(MAX_VISIBLE_DOTS);
  });

  it('счётчик занимает место в ряду, а не появляется сверх точек', () => {
    // Пять публикаций: три точки и «+2», всего четыре места.
    render(<CalendarDayDots dots={makeDots(5)} />);
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(MAX_VISIBLE_DOTS - 1);
    expect(screen.getByTestId('calendar-day-dots-overflow').textContent).toBe('+2');
  });

  it('день без переполнения по-прежнему показывает все точки и не показывает счётчик', () => {
    render(<CalendarDayDots dots={makeDots(MAX_VISIBLE_DOTS)} />);
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(MAX_VISIBLE_DOTS);
    expect(screen.queryByTestId('calendar-day-dots-overflow')).toBeNull();
  });

  it('ряд со счётчиком идёт тесной геометрией, иначе не влезает в ширину дня', () => {
    // Замер в браузере: 3 точки по 6px + зазоры 2px + «+2» девятым кеглем =
    // 37.28px при ячейке 36px; «+14» ещё шире. Тесная геометрия даёт 26.8 и
    // 31.89px соответственно.
    render(<CalendarDayDots dots={makeDots(17)} />);
    const box = screen.getByTestId('calendar-day-dots');
    expect(box.className).toContain('gap-px');
    expect(box.className).not.toContain('gap-0.5');
    expect(screen.getAllByTestId('calendar-day-dot')[0].className).toContain('h-1 w-1');
    expect(screen.getByTestId('calendar-day-dots-overflow').className).toContain('text-[8px]');
  });

  it('день без счётчика сохраняет прежний размер точек и зазор', () => {
    render(<CalendarDayDots dots={makeDots(MAX_VISIBLE_DOTS)} />);
    expect(screen.getByTestId('calendar-day-dots').className).toContain('gap-0.5');
    expect(screen.getAllByTestId('calendar-day-dot')[0].className).toContain('h-1.5 w-1.5');
  });

  it('splitDayDots считает то же самое без рендера', () => {
    expect(splitDayDots(makeDots(4))).toEqual({ visible: makeDots(4), remaining: 0 });
    expect(splitDayDots(makeDots(17)).visible).toHaveLength(MAX_VISIBLE_DOTS - 1);
    expect(splitDayDots(makeDots(17)).remaining).toBe(14);
  });
});
