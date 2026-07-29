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
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  const hasZone = value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

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
