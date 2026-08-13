/**
 * SM-28: подпись часового пояса реально рендерится рядом с выбором даты.
 *
 * Компонент — тонкая обёртка над buildScheduleTimezoneHint, чью ЛОГИКУ
 * (пересчёт, отличие от Москвы) детерминированно тестирует
 * schedule-timezone.test.ts через инжектируемый пояс. Здесь проверяется только
 * то, что компонент выводит подпись применяемого пояса — без mock'а Intl,
 * который ломает внутренности date-fns-tz.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleTimezoneHint } from '@/components/ScheduleTimezoneHint';

describe('SM-28: ScheduleTimezoneHint', () => {
  it('выводит подпись применяемого пояса', () => {
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} />);

    // Подпись всегда начинается с «время в вашем поясе», далее имя пояса и
    // смещение в скобках. Конкретное имя зависит от пояса машины — не
    // проверяем его здесь, это покрывает schedule-timezone.test.ts.
    expect(screen.getByText(/^время в вашем поясе /)).toBeInTheDocument();
  });
});
