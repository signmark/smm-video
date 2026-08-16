import { useMemo } from 'react';
import { buildScheduleTimezoneHint } from '@/lib/schedule-timezone';

/**
 * Подпись часового пояса под выбором даты/времени публикации
 * (SM-28 — подпись, AI-113 — трактовка).
 *
 * Применяемый пояс показывается ВСЕГДА: неоднозначность «по чьему времени»
 * существует в момент выбора, ещё до того, как дата задана.
 *
 * AI-113 развернул вторую строку. Раньше применялся пояс браузера и мы
 * досчитывали Москву; теперь применяется Москва — и досчитывать надо пояс
 * пользователя, иначе человек из другого пояса не понимает, когда пост
 * реально выйдет по его часам. Вторая строка появляется, только если пояс
 * отличается от московского И дата уже выбрана.
 */
export function ScheduleTimezoneHint({ date, zone }: { date?: Date; zone?: string }) {
  const hint = useMemo(
    () => buildScheduleTimezoneHint(date ?? new Date(), new Date(), zone),
    [date, zone],
  );

  return (
    <div className="text-xs text-muted-foreground">
      <p>{hint.label}</p>
      {date && hint.differs && hint.local && (
        <p className="text-muted-foreground/80">
          у вас это {hint.local}
        </p>
      )}
    </div>
  );
}
