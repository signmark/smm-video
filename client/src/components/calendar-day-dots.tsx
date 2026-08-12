/**
 * SM-22: маркеры публикаций в ячейке дня календаря.
 *
 * Календарей в приложении два — `PublicationCalendar` и экран `pages/posts`, —
 * и раньше каждый рисовал точки сам. Ограничение на число видимых маркеров
 * появилось только в одном из них, и день с семнадцатью публикациями во втором
 * календаре по-прежнему выкидывал точки за границы ячейки. Отсюда правило:
 * маркеры дня рисует ОДНА функция, а календари передают ей только данные.
 */

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

/**
 * Сборка маркеров дня для экрана `pages/posts` (SM-22 follow-up).
 *
 * Здесь вход — два раздельных массива (опубликованные и провалившиеся), и
 * семантика «failed первыми» реализуется через порядок spread'а. Общий
 * компонент `CalendarDayDots` НЕ знает про приоритеты статусов; порядок
 * маркеров фиксируется этой функцией и проверяется в
 * `calendar-markers-failed-first.test.tsx`.
 *
 * `getColorForType` — функция цвета, которая зависит от локали и
 * передаётся с call-site.
 *
 * `t` — функция перевода, передаётся с call-site по той же причине.
 */
export function buildPostsScreenDayDots<TKey extends string, TPublication extends { key: TKey; contentType?: string | null }, TFailed extends { id: TKey }>(params: {
  publicationsForDay: TPublication[];
  failedAttemptsForDay: TFailed[];
  getColorForType: (type: string) => string;
  t: (key: string) => string;
}): CalendarDayDot[] {
  return [
    ...params.failedAttemptsForDay.map((content) => ({
      key: `${content.id}:failed`,
      color: 'bg-red-500',
      title: params.t('publishing.published.publicationError'),
    })),
    ...params.publicationsForDay.map((publication) => ({
      key: publication.key,
      color: params.getColorForType(publication.contentType || 'text'),
    })),
  ];
}

export function CalendarDayDots({ dots }: { dots: CalendarDayDot[] }) {
  if (dots.length === 0) return null;

  const { visible, remaining } = splitDayDots(dots);

  return (
    <div
      className="flex justify-center flex-wrap gap-0.5 mt-0.5 overflow-hidden max-w-full"
      data-testid="calendar-day-dots"
    >
      {visible.map((dot) => (
        <div
          key={dot.key}
          data-testid="calendar-day-dot"
          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot.color} ${dot.ring || ''}`}
          style={dot.opacity ? { opacity: dot.opacity } : undefined}
          title={dot.title}
        />
      ))}
      {remaining > 0 && (
        <span
          data-testid="calendar-day-dots-overflow"
          className="text-[9px] leading-none text-muted-foreground font-medium"
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}