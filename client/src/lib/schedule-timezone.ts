/**
 * Часовой пояс планирования публикации (SM-28 — подпись, AI-113 — трактовка).
 *
 * ИСТОРИЯ. Изначально календарь «Запланировать» ставил время через `setHours`
 * в поясе браузера, а команда на естественном языке (`server/utils/ru-datetime`)
 * всегда понимала названное время как московское. Один и тот же ввод «10:00»
 * давал два разных момента — для москвича они совпадали, поэтому расхождение
 * было незаметным. SM-28 сделал его видимым (подпись под выбором даты),
 * AI-113 его устраняет.
 *
 * РЕШЕНИЕ AI-113: единый пояс ввода — московский, на обоих путях. Причина не
 * техническая, а продуктовая: публикация, аналитика и ответы ассистента уже
 * ведутся по Москве, а пояса пользователя мы нигде не храним — для команды,
 * пришедшей из телеграм-бота, его просто неоткуда взять.
 *
 * ЧТО ЭТО НЕ МЕНЯЕТ: в базе лежат абсолютные моменты, поэтому уже
 * запланированные публикации новая трактовка не сдвигает. Проверено замером на
 * боевой записи, а не рассуждением.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

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

/** Тот же абсолютный момент в произвольном поясе, в виде «29.07.2026, 10:00». */
export function formatInZone(date: Date | string, zone: string): string {
  return formatInTimeZone(date, zone, 'dd.MM.yyyy, HH:mm', { locale: undefined });
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

/**
 * Полная подпись применяемого пояса: «время указывается по Москве (МСК, UTC+3)».
 *
 * AI-113: раньше здесь называли пояс браузера, потому что применялся он.
 * Теперь применяется московский — подпись обязана говорить именно это, иначе
 * она врёт ровно в том месте, ради которого её и добавляли.
 */
export function scheduleTimezoneLabel(now: Date = new Date()): string {
  const offset = browserUtcOffsetLabel(now, SCHEDULE_DISPLAY_TIME_ZONE);
  return `время указывается по Москве (${SCHEDULE_DISPLAY_TIME_ZONE_LABEL}, ${offset})`;
}

/**
 * Московское «настенное» время → абсолютный момент.
 *
 * Принимает части так, как их видит человек в поле ввода: год, месяц (1-12),
 * день, часы, минуты. Возвращает момент, который и уходит на сервер.
 * Не зависит от пояса машины: пересчёт делает `fromZonedTime` по явному поясу.
 */
export function moscowWallToInstant(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  const wall = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
  return fromZonedTime(wall, SCHEDULE_DISPLAY_TIME_ZONE);
}

/**
 * Абсолютный момент → дата, у которой ЛОКАЛЬНЫЕ поля равны московским
 * «настенным». Нужна интерфейсу: календарь и поле времени работают с
 * локальными полями, а показывать обязаны московское время.
 *
 * Полученную дату нельзя отправлять на сервер — это не момент, а способ
 * показать московские части. Для отправки есть `moscowWallToInstant`.
 */
export function instantToMoscowWall(date: Date): Date {
  return toZonedTime(date, SCHEDULE_DISPLAY_TIME_ZONE);
}

export interface ScheduleTimezoneHint {
  /** Подпись применяемого пояса (московский + смещение). */
  label: string;
  /**
   * Тот же момент в поясе пользователя, если он отличается от московского.
   * AI-113: направление пересчёта развернулось. Раньше применялся пояс
   * браузера и досчитывали Москву; теперь применяется Москва и досчитывают
   * пояс браузера — иначе пользователь из другого пояса не понимает, когда
   * пост выйдет по его часам.
   */
  local: string | null;
  /** Пояс браузера отличается от Москвы? */
  differs: boolean;
}

/**
 * Собирает подпись и (при необходимости) пересчёт в пояс пользователя.
 * `date` — уже абсолютный момент, собранный из московского ввода;
 * `now` инжектируется для тестируемости смещения; `zone` — пояс браузера
 * (по умолчанию берётся из Intl, инжектируется в тестах).
 */
export function buildScheduleTimezoneHint(
  date: Date,
  now: Date = new Date(),
  zone: string = browserTimeZone(),
): ScheduleTimezoneHint {
  const differs = browserDiffersFromMoscow(zone);
  const mskOffset = browserUtcOffsetLabel(now, SCHEDULE_DISPLAY_TIME_ZONE);
  return {
    label: `время указывается по Москве (${SCHEDULE_DISPLAY_TIME_ZONE_LABEL}, ${mskOffset})`,
    local: differs ? formatInZone(date, zone) : null,
    differs,
  };
}
