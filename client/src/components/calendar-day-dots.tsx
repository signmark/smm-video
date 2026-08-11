/**
 * SM-22: маркеры публикаций в ячейке дня календаря.
 *
 * Календарей в приложении два — `PublicationCalendar` и экран `pages/posts`, —
 * и раньше каждый рисовал точки сам. Ограничение на число видимых маркеров
 * появилось только в одном из них, и день с семнадцатью публикациями во втором
 * календаре по-прежнему выкидывал точки за границы ячейки. Отсюда правило:
 * маркеры дня рисует ОДНА функция, а календари передают ей только данные.
 *
 * Разметка собирается через `createElement`, а не JSX, намеренно: клиентский
 * проект vitest сейчас не трансформирует JSX (в tsconfig стоит `jsx: preserve`,
 * react-плагина в конфигурации тестов нет), и модуль с JSX невозможно
 * импортировать из теста — падает на разборе исходника. Как только конфигурация
 * тестов научится JSX, этот файл можно переписать обычным способом.
 */

import { createElement } from 'react';

export const MAX_VISIBLE_DOTS = 4;

export interface CalendarDayDot {
  /** Ключ для React; уникален в пределах дня. */
  key: string;
  /** Класс фона, например `bg-blue-500`. */
  color: string;
  /** Необязательная рамка статуса, например `ring-2 ring-green-500`. */
  ring?: string;
  /** Прозрачность как строка, чтобы совпадать со стилями статусов. */
  opacity?: string;
  /** Подсказка при наведении. */
  title?: string;
}

/**
 * Возвращает то, что реально попадёт в разметку: видимые маркеры и число
 * скрытых. Вынесено отдельно от компонента, чтобы правило «не больше четырёх»
 * можно было проверить и без рендера.
 */
export function splitDayDots(dots: CalendarDayDot[]): {
  visible: CalendarDayDot[];
  remaining: number;
} {
  const visible = dots.slice(0, MAX_VISIBLE_DOTS);
  return { visible, remaining: dots.length - visible.length };
}

export function CalendarDayDots({ dots }: { dots: CalendarDayDot[] }) {
  if (dots.length === 0) return null;

  const { visible, remaining } = splitDayDots(dots);

  const children: ReturnType<typeof createElement>[] = visible.map((dot) =>
    createElement('div', {
      key: dot.key,
      'data-testid': 'calendar-day-dot',
      className: `h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot.color} ${dot.ring || ''}`,
      style: dot.opacity ? { opacity: dot.opacity } : undefined,
      title: dot.title,
    }),
  );

  if (remaining > 0) {
    children.push(
      createElement(
        'span',
        {
          key: 'overflow',
          'data-testid': 'calendar-day-dots-overflow',
          className: 'text-[9px] leading-none text-muted-foreground font-medium',
        },
        `+${remaining}`,
      ),
    );
  }

  return createElement(
    'div',
    {
      className:
        'flex justify-center flex-wrap gap-0.5 mt-0.5 overflow-hidden max-w-full',
      'data-testid': 'calendar-day-dots',
    },
    children,
  );
}
