/**
 * SM-28: подпись часового пояса реально рендерится рядом с выбором даты.
 *
 * Компонент — тонкая обёртка над buildScheduleTimezoneHint, чью ЛОГИКУ
 * (пересчёт, отличие от Москвы) детерминированно тестирует
 * schedule-timezone.test.ts через инжектируемый пояс. Здесь проверяется
 * условия ПОКАЗА: подпись пояса видна всегда, а строка «…МСК» — только когда
 * дата уже выбрана (и пояс отличается). Бежит под TZ=Europe/Moscow, где
 * «отличается» ложно, поэтому «МСК»-строка здесь всегда отсутствует — это и
 * есть проверяемый контракт для московского пояса.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleTimezoneHint } from '@/components/ScheduleTimezoneHint';

describe('SM-28: ScheduleTimezoneHint — условия показа', () => {
  it('без даты подпись пояса видна, строки с МСК нет', () => {
    render(<ScheduleTimezoneHint />);

    // Подпись применяемого пояса видна всегда.
    expect(screen.getByText(/^время в вашем поясе /)).toBeInTheDocument();
    // Строки пересчёта в МСК нет — дата не выбрана.
    expect(screen.queryByText(/МСК$/)).toBeNull();
  });

  it('с датой подпись пояса видна и (в МСК-поясе) строки с МСК нет', () => {
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} />);

    expect(screen.getByText(/^время в вашем поясе /)).toBeInTheDocument();
    expect(screen.queryByText(/МСК$/)).toBeNull();
  });
});
