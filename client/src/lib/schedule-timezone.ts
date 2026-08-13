/**
 * Подпись часового пояса при планировании публикации (SM-28).
 *
 * Календарь «Запланировать» ставит время через `setHours` в ЛОКАЛЬНОМ поясе
 * браузера, затем `toISOString()` превращает его в UTC-момент (абсолютную
 * величину). Значит применяемый пояс — это пояс браузера/устройства, а не
 * фиксированная Москва. Остальной продукт при этом говорит по-московски
 * (`DISPLAY_TIME_ZONE = Europe/Moscow`), поэтому пользователю из другого пояса
 * надо показать ОБЕ величины — иначе он сравнивает несравнимое.
 *
 * Этот модуль только ВЫЧИСЛЯЕТ подпись; логику времени не меняет.
 */
import { formatInTimeZone } from 'date-fns-tz';

/** Пояс, в котором ведётся остальной интерфейс и который подписывается «МСК». */
export const SCHEDULE_DISPLAY_TIME_ZONE = 'Europe/Moscow';
export const SCHEDULE_DISPLAY_TIME_ZONE_LABEL = 'МСК';

/**
 * Название пояса браузера — то, что реально применяется, когда `setHours`
 * ставит выбранное время. Берётся из Intl, а не угадывается по смещению:
 * смещение летом и зимой разное, а имя устойчиво.
 */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Смещение пояса от UTC в данный момент, в виде «UTC+3» / «UTC−5».
 * Со знаком и без ведущего нуля («+3», а не «+03»). Пояс можно явно указать —
 * тогда смещение считается для него (нужно в тестах и для пересчёта).
 */
export function browserUtcOffsetLabel(now: Date = new Date(), zone?: string): string {
  if (zone) {
    // Достаём часовой компонент из formatToParts с явным поясом — это не
    // зависит от ambient TZ машины и устойчиво к летнему/зимнему времени.
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      // Пересчёт смещения: (zoneLocal - UTC) в минутах.
      const asUtc = Date.UTC(
        Number(get('year')),
        Number(get('month')) - 1,
        Number(get('day')),
        Number(get('hour')),
        Number(get('minute')),
      );
      const totalMinutes = Math.round((asUtc - now.getTime()) / 60000);
      const sign = totalMinutes >= 0 ? '+' : '−';
      const abs = Math.abs(totalMinutes);
      const hours = Math.floor(abs / 60);
      const mins = abs % 60;
      const hourPart = `${hours}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
      return `UTC${sign}${hourPart}`;
    } catch {
      // fallthrough к ambient ниже
    }
  }
  const minutes = now.getTimezoneOffset();
  const totalMinutes = -minutes; // местное − UTC
  const sign = totalMinutes >= 0 ? '+' : '−';
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const hourPart = `${hours}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
  return `UTC${sign}${hourPart}`;
}

/** Смещён ли пояс браузера от московского (по названию, не по значению). */
export function browserDiffersFromMoscow(zone: string = browserTimeZone()): boolean {
  return zone !== SCHEDULE_DISPLAY_TIME_ZONE;
}

/** Тот же абсолютный момент в МСК, в виде «10:00 29.07.2026». */
export function formatInMoscow(date: Date | string): string {
  return formatInTimeZone(
    date,
    SCHEDULE_DISPLAY_TIME_ZONE,
    'dd.MM.yyyy, HH:mm',
    { locale: undefined },
  );
}

/** Полная подпись применяемого пояса: «время в вашем поясе Europe/Moscow (UTC+3)». */
export function scheduleTimezoneLabel(now: Date = new Date()): string {
  const zone = browserTimeZone();
  const offset = browserUtcOffsetLabel(now);
  return `время в вашем поясе ${zone} (${offset})`;
}

export interface ScheduleTimezoneHint {
  /** Подпись применяемого пояса (пояс браузера + смещение). */
  label: string;
  /** Тот же момент в МСК, если пояс браузера отличается от Москвы. */
  msk: string | null;
  /** Пояс браузера отличается от Москвы? */
  differs: boolean;
}

/**
 * Собирает подпись и (при необходимости) пересчёт в МСК для выбранного
 * момента. `date` — то, что выбрал пользователь (уже в локальном поясе через
 * setHours); `now` инжектируется для тестируемости смещения; `zone` — пояс
 * браузера (по умолчанию берётся из Intl, инжектируется в тестах).
 */
export function buildScheduleTimezoneHint(
  date: Date,
  now: Date = new Date(),
  zone: string = browserTimeZone(),
): ScheduleTimezoneHint {
  const differs = browserDiffersFromMoscow(zone);
  const offset = browserUtcOffsetLabel(now, zone);
  return {
    label: `время в вашем поясе ${zone} (${offset})`,
    msk: differs ? formatInMoscow(date) : null,
    differs,
  };
}
