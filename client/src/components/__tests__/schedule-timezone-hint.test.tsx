/**
 * Подпись часового пояса рядом с выбором даты
 * (SM-28 — подпись, AI-113 — трактовка).
 *
 * Компонент — тонкая обёртка над buildScheduleTimezoneHint. Пояс передаётся
 * явным параметром, поэтому тест не зависит от ambient TZ машины, на которой
 * гоняется (именно это когда-то валило гейт: он гоняет test:run без TZ).
 *
 * AI-113 развернул смысл второй строки: применяется московское время, поэтому
 * подпись всегда говорит «по Москве», а досчитывается пояс ПОЛЬЗОВАТЕЛЯ.
 * Красный-до: до правки первая строка называла пояс браузера, и обе проверки
 * ниже про «по Москве» падали.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleTimezoneHint } from '@/components/ScheduleTimezoneHint';

describe('AI-113: ScheduleTimezoneHint — подпись московская, пояс передан явно', () => {
  it('московский пояс: подпись есть, второй строки нет (без даты)', () => {
    render(<ScheduleTimezoneHint zone="Europe/Moscow" />);
    expect(screen.getByText(/^время указывается по Москве/)).toBeInTheDocument();
    expect(screen.queryByText(/^у вас это/)).toBeNull();
  });

  it('московский пояс: с датой второй строки всё равно нет', () => {
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} zone="Europe/Moscow" />);
    expect(screen.getByText(/^время указывается по Москве/)).toBeInTheDocument();
    expect(screen.queryByText(/^у вас это/)).toBeNull();
  });

  it('немосковский пояс: подпись всё равно московская, а не «в вашем поясе»', () => {
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} zone="America/New_York" />);
    expect(screen.getByText(/^время указывается по Москве/)).toBeInTheDocument();
    expect(screen.queryByText(/America\/New_York/)).toBeNull();
  });

  it('немосковский пояс: вторая строка показывает время по часам пользователя', () => {
    // 10:00 МСК = 07:00 UTC = 03:00 по Нью-Йорку (лето).
    render(<ScheduleTimezoneHint date={new Date('2026-07-16T07:00:00.000Z')} zone="America/New_York" />);
    expect(screen.getByText(/^у вас это .*03:00/)).toBeInTheDocument();
  });
});
