/**
 * SM-24. Что показывает метка Telegram в настройках кампании.
 *
 * Раньше метка «Настроено» отвечала на вопрос «заполнены ли поля»: отозванный
 * токен и выгнанный из канала бот выглядели так же, как исправное подключение.
 * Теперь она отвечает на вопрос «дойдёт ли публикация» — по ответу живой
 * проверки связи. Пока ответа нет, метка говорит ровно то, что известно:
 * настройки сохранены.
 *
 * Правило вынесено из компонента отдельно, чтобы его можно было проверить
 * тестом, а не глазами.
 */

export type TelegramBadgeTone = 'ok' | 'pending' | 'unknown' | 'fail';

export interface TelegramBadgeInput {
  isLoading?: boolean;
  isValid?: boolean;
  /**
   * error — виновата настройка; warning — виноват момент. Набор шире, чем
   * нужен самой метке: это тот же тип, которым по всему компоненту настроек
   * описан исход проверки, и сужать его здесь значило бы завести второй.
   */
  severity?: 'error' | 'warning' | 'success';
}

export interface TelegramBadgeState {
  label: string;
  tone: TelegramBadgeTone;
}

export function telegramBadgeState(status: TelegramBadgeInput | undefined): TelegramBadgeState {
  if (status?.isLoading) {
    return { label: 'Проверяем связь', tone: 'pending' };
  }
  if (status?.isValid === true) {
    return { label: 'Связь есть', tone: 'ok' };
  }
  if (status?.isValid === false) {
    // Временный сбой — не приговор подключению: сеть, таймаут и молчание
    // Telegram ничего не говорят о настройках, и требовать от человека
    // действий не за что.
    return status.severity === 'warning'
      ? { label: 'Связь не проверена', tone: 'unknown' }
      : { label: 'Нет связи', tone: 'fail' };
  }
  return { label: 'Настроено', tone: 'ok' };
}

export const TELEGRAM_BADGE_CLASSES: Record<TelegramBadgeTone, string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100',
  unknown: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  fail: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
};
