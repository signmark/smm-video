/**
 * SM-22 follow-up: «неудачи идут первыми» в обоих календарях.
 *
 * Контракт:
 *   1. failed/red markers идут первыми, затем non-failed;
 *   2. стабильный порядок внутри групп;
 *   3. в ряду 4 места (в `calendar-day-dots.test.tsx` — контракт компонента);
 *   4. +N считает весь overflow, включая точку, чьё место занял счётчик;
 *   5. в `PublicationCalendar` сначала status-priority sort и затем общий
 *      dots component; в `posts` screen — failed-first для отдельного списка;
 *   6. red-before на каждом call-site;
 *   7. parity component test двух реализаций.
 *
 * Тесты на чистую функцию `buildPostsScreenDayDots` (для экрана постов) —
 * не на grep по исходнику, потому что grep не отличает код от
 * комментариев и не видит порядок внутри spread'а. Вызываем функцию
 * напрямую и проверяем результат.
 *
 * Red-before: на main (без #44) `buildPostsScreenDayDots` либо не
 * существует, либо возвращает массив в неправильном порядке. Тест
 * падает по назначению.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CalendarDayDots,
  buildPostsScreenDayDots,
  type CalendarDayDot,
} from '@/components/calendar-day-dots';

describe('SM-22 follow-up: failed first в экране постов', () => {
  it('buildPostsScreenDayDots: failed первыми в выходном массиве', () => {
    const publications = [
      { key: 'p1', contentType: 'text' },
      { key: 'p2', contentType: 'text' },
      { key: 'p3', contentType: 'text' },
    ];
    const failed = [
      { id: 'f1' },
      { id: 'f2' },
    ];
    const dots = buildPostsScreenDayDots({
      publicationsForDay: publications,
      failedAttemptsForDay: failed,
      getColorForType: () => 'bg-blue-500',
      t: () => 't-error',
    });
    expect(dots).toHaveLength(5);
    // Failed идут первыми — 2 f-mаркера, затем 3 p-маркера.
    expect(dots[0].key).toBe('f1:failed');
    expect(dots[0].color).toBe('bg-red-500');
    expect(dots[1].key).toBe('f2:failed');
    expect(dots[2].key).toBe('p1');
    expect(dots[3].key).toBe('p2');
    expect(dots[4].key).toBe('p3');
  });

  it('buildPostsScreenDayDots: стабильный порядок ВНУТРИ групп (входной порядок)', () => {
    const publications = [
      { key: 'a', contentType: 'text' },
      { key: 'b', contentType: 'text' },
      { key: 'c', contentType: 'text' },
    ];
    const failed = [
      { id: 'x' },
      { id: 'y' },
    ];
    const dots = buildPostsScreenDayDots({
      publicationsForDay: publications,
      failedAttemptsForDay: failed,
      getColorForType: () => 'bg-blue-500',
      t: () => '',
    });
    // Внутри failed-блока порядок входной: x, y.
    expect(dots[0].key).toBe('x:failed');
    expect(dots[1].key).toBe('y:failed');
    // Внутри published-блока порядок входной: a, b, c.
    expect(dots[2].key).toBe('a');
    expect(dots[3].key).toBe('b');
    expect(dots[4].key).toBe('c');
  });

  it('buildPostsScreenDayDots: edge cases', () => {
    const emptyDots = buildPostsScreenDayDots({
      publicationsForDay: [],
      failedAttemptsForDay: [],
      getColorForType: () => 'bg-blue-500',
      t: () => '',
    });
    expect(emptyDots).toEqual([]);

    const onlyFailed = buildPostsScreenDayDots({
      publicationsForDay: [],
      failedAttemptsForDay: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }, { id: 'f5' }],
      getColorForType: () => 'bg-blue-500',
      t: () => '',
    });
    expect(onlyFailed).toHaveLength(5);
    expect(onlyFailed.every((d) => d.color === 'bg-red-500')).toBe(true);

    const onlyPublished = buildPostsScreenDayDots({
      publicationsForDay: [{ key: 'a' }, { key: 'b' }],
      failedAttemptsForDay: [],
      getColorForType: () => 'bg-blue-500',
      t: () => '',
    });
    expect(onlyPublished.every((d) => d.color === 'bg-blue-500')).toBe(true);
  });
});

describe('SM-22 follow-up: failed first в общем компоненте (parity)', () => {
  it('failed в dots появляется в DOM раньше, чем published, при правильном порядке call-site', () => {
    // Этот тест эмулирует «как оба call-site отдают `dots`» — failed первыми.
    // Сам компонент не пересортирует; порядок — ответственность call-site.
    const dots: CalendarDayDot[] = [
      { key: 'f1', color: 'bg-red-500', title: 'failed' },
      { key: 'p1', color: 'bg-blue-500' },
      { key: 'p2', color: 'bg-blue-500' },
      { key: 'p3', color: 'bg-blue-500' },
    ];
    const { container } = render(<CalendarDayDots dots={dots} />);
    const allDots = container.querySelectorAll('[data-testid="calendar-day-dot"]');
    expect(allDots).toHaveLength(4);
    // 4 видимых — лимит 4.
    const first = allDots[0] as HTMLElement;
    expect(first.className).toContain('bg-red-500');
  });

  it('мест в ряду 4: 5 → 3 видимых +2, 4 → 4 без overflow', () => {
    // Cleanup DOM между assertions — RTL render не unmount автоматически.
    // SM-22: счётчик занимает одно из четырёх мест ряда, а не появляется сверх
    // них — иначе он не влезает в 36px ячейки и переносом растягивает день.
    const dots5: CalendarDayDot[] = Array.from({ length: 5 }, (_, i) => ({
      key: `p-${i}`,
      color: 'bg-blue-500',
    }));
    const { unmount: u5 } = render(<CalendarDayDots dots={dots5} />);
    expect(screen.getAllByTestId('calendar-day-dot')).toHaveLength(3);
    expect(screen.getByTestId('calendar-day-dots-overflow').textContent).toBe('+2');
    u5();

    const dots4: CalendarDayDot[] = Array.from({ length: 4 }, (_, i) => ({
      key: `p-${i}`,
      color: 'bg-blue-500',
    }));
    const { unmount: u4, container } = render(<CalendarDayDots dots={dots4} />);
    expect(container.querySelectorAll('[data-testid="calendar-day-dot"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="calendar-day-dots-overflow"]')).toBeNull();
    u4();
  });
});