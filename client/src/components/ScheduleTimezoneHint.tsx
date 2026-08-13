import { useMemo } from 'react';
import { buildScheduleTimezoneHint } from '@/lib/schedule-timezone';

/**
 * Подпись часового пояса под выбором даты/времени публикации (SM-28).
 *
 * Имя применяемого пояса и смещение показываются ВСЕГДА — неоднозначность
 * «по чьему времени» существует в момент выбора, ещё до того, как дата задана.
 * Строка с московским эквивалентом — только когда дата уже выбрана И пояс
 * отличается от московского (дата нужна только для пересчёта).
 */
export function ScheduleTimezoneHint({ date, zone }: { date?: Date; zone?: string }) {
  const hint = useMemo(
    () => buildScheduleTimezoneHint(date ?? new Date(), new Date(), zone),
    [date, zone],
  );

  return (
    <div className="text-xs text-muted-foreground">
      <p>{hint.label}</p>
      {date && hint.differs && hint.msk && (
        <p className="text-muted-foreground/80">
          {hint.msk} МСК
        </p>
      )}
    </div>
  );
}
