import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

/**
 * Форматирует дату с правильным учетом часового пояса пользователя
 * @param dateString строка с датой или объект даты
 * @param formatStr формат вывода даты (по умолчанию 'dd MMMM yyyy, HH:mm')
 * @param needsTimezoneOffset УСТАРЕЛО - оставлено для обратной совместимости, игнорируется
 * @returns отформатированная дата в часовом поясе пользователя
 */
export function formatDateWithTimezone(
  dateString: string | Date | null | undefined,
  formatStr: string = 'dd MMMM yyyy, HH:mm',
  needsTimezoneOffset: boolean = false
): string {
  if (!dateString) return 'Дата не указана';
  
  try {
    // Получаем часовой пояс пользователя
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // ИСПРАВЛЕНИЕ: Если строка без timezone (без Z), добавляем Z чтобы парсить как UTC
    let dateStr = typeof dateString === 'string' ? dateString : dateString.toISOString();
    if (typeof dateString === 'string' && !dateString.endsWith('Z') && !dateString.includes('+')) {
      dateStr = dateStr + 'Z'; // Принудительно считаем UTC
    }
    
    // Конвертируем строку в объект Date если нужно
    const date = typeof dateString === 'string' ? new Date(dateStr) : dateString;
    
    // Проверяем, что дата валидна
    if (isNaN(date.getTime())) {
      console.warn('Невалидная дата:', dateString);
      return 'Некорректная дата';
    }
    
    // Форматируем дату с использованием часового пояса пользователя
    return formatInTimeZone(date, userTimeZone, formatStr, { locale: ru });
  } catch (error) {
    console.error('Ошибка при форматировании даты:', error);
    return 'Ошибка форматирования даты';
  }
}

/**
 * Форматирует время в формате HH:MM из даты в локальном часовом поясе пользователя
 * @param dateString строка с датой или объект даты
 * @returns отформатированное время
 */
export function formatTimeWithTimezone(
  dateString: string | Date | null | undefined
): string {
  return formatDateWithTimezone(dateString, 'HH:mm');
}