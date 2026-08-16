/**
 * AI-113: календарь планирования трактует введённое время как МОСКОВСКОЕ.
 *
 * Что здесь проверяется по существу: один и тот же ввод «16.07.2026 10:00»
 * обязан давать один и тот же абсолютный момент независимо от пояса машины,
 * и этот момент обязан совпадать с тем, как то же самое понимает AI-команда
 * (server/utils/ru-datetime — трактует названное время по Москве).
 *
 * Пояс переключается через process.env.TZ прямо в тесте: с Node 16 это меняет
 * поведение Date на лету, поэтому оба пояса закрыты одним файлом и не требуют
 * отдельного прогона. Прогон под TZ=Europe/Moscow и TZ=America/New_York всё
 * равно есть (test:dates:msk / test:dates:ny) — как страховка от того, что
 * переключение перестанет работать.
 *
 * Красный-до: до правки календарь ставил время через setHours в поясе машины.
 * Под TZ=America/New_York «10:00» превращалось в 14:00 UTC вместо 07:00 UTC —
 * проверка ожидаемого момента падала.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimePicker } from '@/components/ui/date-time-picker';

/** Тот же самый литерал зафиксирован в серверном тесте ru-datetime. */
const SHARED_10_00_MSK = '2026-07-16T07:00:00.000Z';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe.each([
  ['Europe/Moscow', 'московский пояс'],
  ['America/New_York', 'немосковский пояс'],
  ['Asia/Yekaterinburg', 'пояс восточнее Москвы'],
])('AI-113: DateTimePicker под TZ=%s (%s)', (tz) => {
  beforeEach(() => {
    process.env.TZ = tz;
  });

  it('показывает московское время, а не время машины', () => {
    // 07:00 UTC = 10:00 МСК.
    render(<DateTimePicker value={new Date(SHARED_10_00_MSK)} />);
    expect(screen.getByTestId('input-schedule-time')).toHaveValue('10:00');
  });

  it('подписывает поле как МСК', () => {
    render(<DateTimePicker value={new Date(SHARED_10_00_MSK)} />);
    expect(screen.getByTestId('label-schedule-zone')).toHaveTextContent('МСК');
  });

  it('введённое время отдаёт как момент, посчитанный по Москве', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={new Date(SHARED_10_00_MSK)} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-schedule-time'), { target: { value: '12:30' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as Date;
    // 12:30 МСК = 09:30 UTC, в любом поясе машины.
    expect(emitted.toISOString()).toBe('2026-07-16T09:30:00.000Z');
  });

  it('момент для «10:00» совпадает с трактовкой AI-команды', () => {
    const onChange = vi.fn();
    // Стартуем с другого времени: у управляемого поля повторная установка того
    // же значения события не даёт, и проверка молча ничего бы не проверила.
    render(<DateTimePicker value={new Date('2026-07-16T09:30:00.000Z')} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-schedule-time'), { target: { value: '10:00' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as Date;
    expect(emitted.toISOString()).toBe(SHARED_10_00_MSK);
  });

  it('полночь по Москве не уезжает на соседний день', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={new Date(SHARED_10_00_MSK)} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-schedule-time'), { target: { value: '00:00' } });

    const emitted = onChange.mock.calls[0][0] as Date;
    expect(emitted.toISOString()).toBe('2026-07-15T21:00:00.000Z');
  });
});
