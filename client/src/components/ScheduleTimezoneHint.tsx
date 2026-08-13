import { useMemo } from 'react';
import { buildScheduleTimezoneHint } from '@/lib/schedule-timezone';

/**
 * Подпись часового пояса под выбором даты/времени публикации (SM-28).
 *
 * Показывает, в каком поясе будет выполнена публикация (пояс браузера, которым
 * ставит время календарь), и — если он отличается от московского, в котором
 * говорит остальной продукт — тот же момент в МСК.
 */
export function ScheduleTimezoneHint({ date }: { date: Date }) {
  const hint = useMemo(() => buildScheduleTimezoneHint(date), [date]);

  return (
    <div className="text-xs text-muted-foreground">
      <p>{hint.label}</p>
      {hint.differs && hint.msk && (
        <p className="text-muted-foreground/80">
          {hint.msk} МСК
        </p>
      )}
    </div>
  );
}
