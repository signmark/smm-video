/**
 * Разбор русских формулировок времени публикации: «завтра в 10:00», «сегодня вечером»,
 * «5 августа в 9:30», «через 2 часа», «в понедельник».
 *
 * Весь ввод трактуется как московское время (UTC+3) — так же, как это делает
 * pickSmartScheduleTimes в ai-assistant/command-handlers.ts. Результат — ISO-строка в UTC.
 *
 * Функция чистая: «сейчас» передаётся параметром, чтобы тесты не зависели от часов машины.
 *
 * Две грабли, на которые тут легко наступить:
 *  1. `\b` в JS опирается на \w = [A-Za-z0-9_], поэтому с кириллицей НЕ работает:
 *     /\bзавтра\b/ не находит «завтра». Границы слов строим лукэраундами (см. BOUND_*).
 *  2. Дату нужно разобрать и вырезать из строки ДО разбора времени, иначе «05.08.2026»
 *     читается регуляркой времени как 05:08.
 */

const MSK_OFFSET_HOURS = 3;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Минимальный отступ вперёд: планировщик всё равно не успеет отработать ближе. */
const MIN_LEAD_MS = 5 * MS_PER_MINUTE;

/** Час по МСК, если пользователь назвал дату, но не назвал время. */
const DEFAULT_HOUR_MSK = 10;

/** Символы, которые считаем «буквой слова» для границ (кириллица + латиница + цифры). */
const WORD_CHAR = '[0-9a-zа-я]';
const BOUND_BEFORE = `(?<!${WORD_CHAR})`;
const BOUND_AFTER = `(?!${WORD_CHAR})`;

/** Регулярка с юникод-безопасными границами слова. */
function word(pattern: string, flags = ''): RegExp {
  return new RegExp(`${BOUND_BEFORE}(?:${pattern})${BOUND_AFTER}`, flags);
}

/** Стебли дней недели → номер дня (0 = воскресенье), длинные формы раньше коротких. */
const WEEKDAYS: Array<[string, number]> = [
  ['воскресень[а-я]*', 0],
  ['понедельник[а-я]*', 1],
  ['вторник[а-я]*', 2],
  ['сред[ауые][а-я]*', 3],
  ['четверг[а-я]*', 4],
  ['пятниц[а-я]*', 5],
  ['суббот[а-я]*', 6],
  ['вс', 0], ['пн', 1], ['вт', 2], ['ср', 3], ['чт', 4], ['пт', 5], ['сб', 6],
];

/** Стебли месяцев → индекс месяца (0 = январь). */
const MONTHS: Array<[string, number]> = [
  ['январ[а-я]*', 0],
  ['феврал[а-я]*', 1],
  ['март[а-я]*', 2],
  ['апрел[а-я]*', 3],
  ['ма[йя][а-я]*', 4],
  ['июн[а-я]*', 5],
  ['июл[а-я]*', 6],
  ['август[а-я]*', 7],
  ['сентябр[а-я]*', 8],
  ['октябр[а-я]*', 9],
  ['ноябр[а-я]*', 10],
  ['декабр[а-я]*', 11],
];

/** Части суток → час по МСК. */
const DAY_PARTS: Array<[string, number]> = [
  ['утр[оаму][а-я]*', 9],
  ['днем|в обед', 13],
  ['вечер[оаму][а-я]*', 19],
  ['ноч[ьаию][а-я]*', 23],
];

interface MskParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Раскладывает момент времени на «настенные» части по МСК. */
function toMskParts(instant: Date): MskParts {
  const shifted = new Date(instant.getTime() + MSK_OFFSET_HOURS * MS_PER_HOUR);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Собирает московское «настенное» время обратно в UTC-момент. */
function fromMskParts(parts: MskParts): Date {
  return new Date(Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour - MSK_OFFSET_HOURS,
    parts.minute,
    0,
    0,
  ));
}

interface DateMatch {
  year: number;
  month: number;
  day: number;
  /** Кусок текста, который дату задал — вырезается перед разбором времени. */
  matched: string;
}

function shiftDays(base: MskParts, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(base.year, base.month, base.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function isBeforeDate(candidate: { year: number; month: number; day: number }, today: MskParts): boolean {
  return Date.UTC(candidate.year, candidate.month, candidate.day)
    < Date.UTC(today.year, today.month, today.day);
}

/** Сколько дней в месяце. День 0 следующего месяца — это последний день текущего. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Существует ли такая дата в календаре.
 *
 * Проверки `day <= 31` мало: Date.UTC молча нормализует несуществующую дату в
 * соседний месяц, и «31.02.2027 в 12:00» превращалось в 3 марта 2027. Публикация
 * уезжала на другой день, и пользователь об этом не узнавал.
 */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 0 || month > 11) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/**
 * Результат разбора даты. `invalid` отличается от `none` намеренно: «даты не назвали»
 * означает «возьми сегодняшнюю», а «назвали несуществующую» обязано провалить разбор
 * целиком, иначе 31 февраля тихо станет каким-нибудь другим днём.
 */
type DateParse =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'date'; value: DateMatch };

/** Ищет дату (без времени) по МСК. */
function parseDatePart(text: string, todayMsk: MskParts): DateParse {
  for (const [stem, offset] of [['послезавтра', 2], ['завтра', 1], ['сегодня', 0]] as Array<[string, number]>) {
    const match = text.match(word(stem));
    if (match) return { kind: 'date', value: { ...shiftDays(todayMsk, offset), matched: match[0] } };
  }

  // «05.08», «05.08.2026» — проверяем раньше словесной формы, чтобы точки не утекли в разбор времени
  const numeric = text.match(word('(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?'));
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      let year = todayMsk.year;
      if (numeric[3]) {
        const raw = Number(numeric[3]);
        year = raw < 100 ? 2000 + raw : raw;
      }
      const candidate = { year, month, day };
      if (!numeric[3] && isBeforeDate(candidate, todayMsk)) candidate.year += 1;
      // Проверяем после подбора года: 29.02 валидно только в високосный.
      if (!isValidCalendarDate(candidate.year, candidate.month, candidate.day)) {
        return { kind: 'invalid' };
      }
      return { kind: 'date', value: { ...candidate, matched: numeric[0] } };
    }
  }

  // «5 августа», «5 августа 2026»
  for (const [stem, monthIndex] of MONTHS) {
    const match = text.match(word(`(\\d{1,2})\\s+(?:${stem})(?:\\s+(20\\d{2}))?`));
    if (!match) continue;
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;
    const explicitYear = match[2] ? Number(match[2]) : null;
    const candidate = { year: explicitYear ?? todayMsk.year, month: monthIndex, day };
    // Без указания года «5 января», сказанное в декабре, означает следующий год.
    if (!explicitYear && isBeforeDate(candidate, todayMsk)) candidate.year += 1;
    if (!isValidCalendarDate(candidate.year, candidate.month, candidate.day)) {
      return { kind: 'invalid' };
    }
    return { kind: 'date', value: { ...candidate, matched: match[0] } };
  }

  // «в понедельник», «во вторник» — ближайший будущий такой день
  const currentWeekday = new Date(Date.UTC(todayMsk.year, todayMsk.month, todayMsk.day)).getUTCDay();
  for (const [stem, weekday] of WEEKDAYS) {
    const match = text.match(word(`(?:в|во)\\s+(?:${stem})`));
    if (!match) continue;
    let delta = (weekday - currentWeekday + 7) % 7;
    if (delta === 0) delta = 7; // «в понедельник», сказанное в понедельник, — это следующий
    return { kind: 'date', value: { ...shiftDays(todayMsk, delta), matched: match[0] } };
  }

  return { kind: 'none' };
}

/** Ищет час и минуту. Возвращает null, если время в тексте не названо. */
function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  // «в 10:00», «10:00», «в 10.30»
  const exact = text.match(word('(\\d{1,2})[:.](\\d{2})'));
  if (exact) {
    const hour = Number(exact[1]);
    const minute = Number(exact[2]);
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }

  // «в 10 утра», «в 7 вечера», «в 10 часов», «в 10»
  const loose = text.match(word('(?:в|во)\\s+(\\d{1,2})\\s*(утра|вечера|дня|ночи|час[а-я]*)?'));
  if (loose) {
    let hour = Number(loose[1]);
    const qualifier = loose[2] || '';
    if (hour <= 23) {
      if (/вечера|дня/.test(qualifier) && hour < 12) hour += 12;
      if (/ночи/.test(qualifier) && hour === 12) hour = 0;
      if (/утра/.test(qualifier) && hour === 12) hour = 0;
      return { hour, minute: 0 };
    }
  }

  for (const [stem, hour] of DAY_PARTS) {
    if (word(stem).test(text)) return { hour, minute: 0 };
  }

  return null;
}

/** «через 2 часа», «через 30 минут», «через 3 дня» — считается от «сейчас». */
function parseRelativeOffset(text: string, now: Date): Date | null {
  const match = text.match(word('через\\s+(\\d{1,3})\\s*(минут[а-я]*|мин|час[а-я]*|дн[а-я]*|день|недел[а-я]*)'));
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (/^мин/.test(unit)) return new Date(now.getTime() + amount * MS_PER_MINUTE);
  if (/^час/.test(unit)) return new Date(now.getTime() + amount * MS_PER_HOUR);
  if (/^недел/.test(unit)) return new Date(now.getTime() + amount * 7 * MS_PER_DAY);
  return new Date(now.getTime() + amount * MS_PER_DAY);
}

export interface ParsedSchedule {
  /** Момент публикации в UTC, ISO-8601. */
  iso: string;
  /** Пользователь назвал время (точное или частью суток). */
  hasExplicitTime: boolean;
  /** Пользователь назвал дату. */
  hasExplicitDate: boolean;
}

/**
 * Разбирает фразу вида «завтра в 10:00» в конкретный момент публикации.
 * Возвращает null, если во фразе нет ни даты, ни времени — вызывающий откатывается
 * на автоподбор слотов.
 *
 * Результат всегда в будущем: время без даты, которое сегодня уже прошло, едет на завтра.
 */
export function parseRussianSchedule(input: string, now: Date = new Date()): ParsedSchedule | null {
  if (!input || typeof input !== 'string') return null;

  const text = input.toLowerCase().replace(/ё/g, 'е').trim();
  if (!text) return null;

  // «через N часов» — самостоятельная форма, дату и время суток не разбираем
  const relative = parseRelativeOffset(text, now);
  if (relative) {
    return { iso: relative.toISOString(), hasExplicitTime: true, hasExplicitDate: true };
  }

  const todayMsk = toMskParts(now);
  const parsedDate = parseDatePart(text, todayMsk);

  // Названа несуществующая дата — это отказ, а не повод молча взять соседний день.
  if (parsedDate.kind === 'invalid') return null;

  const datePart = parsedDate.kind === 'date' ? parsedDate.value : null;

  // Дату вырезаем, иначе «05.08.2026» прочитается разбором времени как 05:08.
  const textForTime = datePart ? text.replace(datePart.matched, ' ') : text;
  const timePart = parseTimeOfDay(textForTime);

  if (!datePart && !timePart) return null;

  const parts: MskParts = {
    year: datePart?.year ?? todayMsk.year,
    month: datePart?.month ?? todayMsk.month,
    day: datePart?.day ?? todayMsk.day,
    hour: timePart?.hour ?? DEFAULT_HOUR_MSK,
    minute: timePart?.minute ?? 0,
  };

  let instant = fromMskParts(parts);

  // Названо только время — если оно на сегодня уже прошло, имеется в виду завтра.
  if (!datePart && instant.getTime() < now.getTime() + MIN_LEAD_MS) {
    instant = fromMskParts({ ...parts, day: parts.day + 1 });
  }

  // Названа дата в прошлом — планировать в прошлое нельзя.
  if (instant.getTime() < now.getTime() + MIN_LEAD_MS) return null;

  return {
    iso: instant.toISOString(),
    hasExplicitTime: timePart !== null,
    hasExplicitDate: datePart !== null,
  };
}

/** Человекочитаемая подпись момента по МСК — для ответов ассистента. */
export function formatMskLabel(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
