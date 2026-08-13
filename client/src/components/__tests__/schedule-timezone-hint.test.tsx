/**
 * SM-28: подпись часового пояса реально рендерится рядом с выбором даты.
 *
 * Компонент — тонкая обёртка над buildScheduleTimezoneHint. Пояс передаётся
 * явным параметром, поэтому тест не зависит от ambient TZ машины, на которой
 * гоняется (именно это и валило гейт: он гоняет test:run без TZ, а здесь была
 * expectation «московский пояс → строки МСК нет»). Здесь закрыты ОБА случая:
 * московский пояс (строки «МСК» нет) и немосковский (строка есть и верна).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleTimezoneHint } from '@/components/ScheduleTimezoneHint';

describe('SM-28: ScheduleTimezoneHint — пояс передан явно', () => {
  it('московский пояс: подпись есть, строки МСК нет (без даты)', () => {
    render(<ScheduleTimezoneHint zone="Europe/Moscow" />);
    expect(screen.getByText(/^время в вашем поясе Europe\/Moscow/)).toBeInTheDocument();
    expect(screen.queryByText(/МСК$/)).toBeNull();
  });

  it('московский пояс: с датой строки МСК всё равно нет', () => {
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} zone="Europe/Moscow" />);
    expect(screen.getByText(/^время в вашем поясе Europe\/Moscow/)).toBeInTheDocument();
    expect(screen.queryByText(/МСК$/)).toBeNull();
  });

  it('немосковский пояс: строка МСК есть и показывает пересчёт', () => {
    // 14:00 UTC = 17:00 МСК летом.
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T14:00:00.000Z')} zone="America/New_York" />);
    expect(screen.getByText(/^время в вашем поясе America\/New_York/)).toBeInTheDocument();
    expect(screen.getByText(/17:00/)).toBeInTheDocument();
    expect(screen.getByText(/МСК$/)).toBeInTheDocument();
  });
});
