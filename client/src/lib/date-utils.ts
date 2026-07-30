import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

/**
 * Единый часовой пояс отображения — московский.
 *
 * Почему фиксированный, а не пояс браузера (SM-9).
 *
 * Сервер трактует введённое пользователем время публикации как МОСКОВСКОЕ:
 * `server/utils/ru-datetime.ts` вычитает +3 и хранит UTC-момент. То есть «час
 * ночи», выбранный в интерфейсе, — это 01:00 МСК, и Telegram потом показывает
 * пост именно этим временем.
 *
 * Клиент же показывал время в поясе МАШИНЫ ЗРИТЕЛЯ. Пока обе стороны в Москве,
 * разницы не видно; на машине в UTC получается ровно то, что поймали
 * тестировщики: канал показывает 01:00 29-го, карточка — 22:00, а график
 * активности группирует по дате той же локальной конвертации и рисует
 * публикацию прошлым числом. Один сдвиг, два симптома.
 *
 * Раз ВВОД московский, то и ВЫВОД обязан быть московским — иначе пользователь
 * из любого другого пояса видит не то время, которое сам поставил.
 */
export const DISPLAY_TIME_ZONE = 'Europe/Moscow';

/** Подпись к времени, чтобы пояс не приходилось угадывать. */
export const DISPLAY_TIME_ZONE_LABEL = 'МСК';

/**
 * Приводит значение к `Date`, считая строку без пояса за UTC.
 *
 * Directus отдаёт часть timestamp'ов без `Z`. Без этой нормализации браузер
 * трактовал бы такую строку как местное время и добавлял к расхождению ещё
 * одно.
 */
export function normalizeTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;

  const hasZone = value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/** Внутреннее имя, оставленное ради читаемости остальных функций модуля. */
const toDate = normalizeTimestamp;

/**
 * Форматирует дату в московском времени.
 *
 * @param dateString строка с датой или объект даты
 * @param formatStr формат вывода (по умолчанию 'dd MMMM yyyy, HH:mm')
 * @param _needsTimezoneOffset УСТАРЕЛО, игнорируется — оставлено, чтобы не
 *        править десятки мест вызова
 */
export function formatDateWithTimezone(
  dateString: string | Date | null | undefined,
  formatStr: string = 'dd MMMM yyyy, HH:mm',
  _needsTimezoneOffset: boolean = false
): string {
  if (!dateString) return 'Дата не указана';

  try {
    const date = toDate(dateString);

    if (isNaN(date.getTime())) {
      console.warn('Невалидная дата:', dateString);
      return 'Некорректная дата';
    }

    return formatInTimeZone(date, DISPLAY_TIME_ZONE, formatStr, { locale: ru });
  } catch (error) {
    console.error('Ошибка при форматировании даты:', error);
    return 'Ошибка форматирования даты';
  }
}

/** Время в формате HH:mm по Москве. */
export function formatTimeWithTimezone(
  dateString: string | Date | null | undefined
): string {
  return formatDateWithTimezone(dateString, 'HH:mm');
}

/**
 * Календарный день по Москве в виде `YYYY-MM-DD`.
 *
 * Нужен везде, где записи группируются по датам (график активности, разбивка
 * контента по дням). Раньше день брали из локальных `getFullYear/getMonth/
 * getDate`, поэтому у зрителя западнее Москвы ночная публикация уезжала на
 * предыдущее число.
 */
export function toDisplayDateKey(dateString: string | Date | null | undefined): string | null {
  if (!dateString) return null;

  const date = toDate(dateString);
  if (isNaN(date.getTime())) return null;

  return formatInTimeZone(date, DISPLAY_TIME_ZONE, 'yyyy-MM-dd');
}

/**
 * Календарный день, ВЫБРАННЫЙ пользователем, в виде `YYYY-MM-DD`.
 *
 * Отличается от `toDisplayDateKey` принципиально, и путать их нельзя.
 *
 * `toDisplayDateKey` получает МОМЕНТ ВРЕМЕНИ (timestamp публикации) и отвечает,
 * на какие московские сутки он попадает. А дата из календарного виджета — это
 * не момент, а «стена»: пользователь ткнул в клетку «29 июля», и виджет отдал
 * `Date`, собранный из локальной полуночи. Прогонять её через пересчёт поясов
 * значит сдвинуть выбор пользователя на сутки у любого зрителя западнее Москвы —
 * то есть внести ровно ту ошибку, от которой мы уходим.
 *
 * Поэтому здесь читаются ЛОКАЛЬНЫЕ компоненты: они и есть то, что человек видел
 * в клетке.
 */
export function toWallDateKey(date: Date | null | undefined): string | null {
  if (!date || isNaN(date.getTime())) return null;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Сегодняшний день по Москве, `YYYY-MM-DD`. */
export function displayTodayKey(): string {
  return formatInTimeZone(new Date(), DISPLAY_TIME_ZONE, 'yyyy-MM-dd');
}

/**
 * Сегодняшний московский день как «стена» — `Date` из ЛОКАЛЬНОЙ полуночи.
 *
 * Нужен там, где московскую дату кладут в календарный виджет: `useState(new
 * Date())` для выбранного дня и `startOfMonth(new Date())` для видимого месяца
 * брали браузерное «сегодня», и около московской полуночи зритель в UTC,
 * Нью-Йорке или Токио открывал календарь на ДРУГОМ дне и другом месяце, чем
 * человек в Москве (находка приёмки 30.07.2026).
 *
 * Возвращается именно wall-Date, а не момент: виджет и `toWallDateKey` читают
 * локальные компоненты, и пересчитывать этот `Date` по поясам нельзя — иначе
 * внесём ровно тот сдвиг, от которого уходим. Пара к `toWallDateKey`:
 * `toWallDateKey(displayToday())` всегда равен `displayTodayKey()`.
 */
export function displayToday(): Date {
  const [year, month, day] = displayTodayKey().split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Попадает ли момент на сегодняшние МОСКОВСКИЕ сутки. */
export function isDisplayToday(value: string | Date | null | undefined): boolean {
  const key = toDisplayDateKey(value);
  return key !== null && key === displayTodayKey();
}

/** Попадают ли два момента на одни и те же московские сутки. */
export function isSameDisplayDay(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean {
  const ka = toDisplayDateKey(a);
  const kb = toDisplayDateKey(b);
  return ka !== null && ka === kb;
}

/**
 * Начало недели — ПОНЕДЕЛЬНИК. Задано явно и в одном месте.
 *
 * `isThisWeek` из date-fns без опций считает неделю с воскресенья: в
 * русскоязычном продукте это молча сдвигало «за неделю» на день, и вдобавок
 * считалось по локальной полуночи зрителя.
 */
export const DISPLAY_WEEK_STARTS_ON_MONDAY = true;

/** Ключ понедельника той московской недели, в которую попадает момент. */
function displayWeekStartKey(value: string | Date | null | undefined): string | null {
  const key = toDisplayDateKey(value);
  if (!key) return null;

  // Полдень, чтобы арифметика по суткам не задевала переход даты.
  const noon = new Date(`${key}T12:00:00Z`);
  // getUTCDay: 0 — воскресенье. Переводим в «сколько дней назад понедельник».
  const backToMonday = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - backToMonday);
  return noon.toISOString().slice(0, 10);
}

/** Попадает ли момент на текущую МОСКОВСКУЮ неделю (с понедельника). */
export function isInDisplayWeek(value: string | Date | null | undefined): boolean {
  const week = displayWeekStartKey(value);
  return week !== null && week === displayWeekStartKey(new Date());
}
