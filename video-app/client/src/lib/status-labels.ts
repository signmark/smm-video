/**
 * Человеческие подписи и цвета статусов проекта — в одном месте.
 *
 * ЗАЧЕМ. Подписи жили дважды: в `Home.tsx` (шесть статусов) и в
 * `VideoDetail.tsx` (девять). Списки разошлись, и 22.08 владелец увидел в
 * галерее служебное слово `script_ready` — в карточке проекта у того же
 * статуса подпись «Сценарий готов» была, а в галерее нет. Пока карт две,
 * такое расхождение не вопрос внимательности, а вопрос времени.
 *
 * ПОЧЕМУ ЦВЕТА ШЕСТНАДЦАТЕРИЧНЫЕ, А НЕ ПЕРЕМЕННЫЕ CSS. Галерея строит
 * полупрозрачную подложку значка приписыванием альфы к цвету
 * (`color + '22'`), а к `var(--green)` приписать альфу нельзя. Значения те
 * же самые, что лежат в переменных `index.css`.
 */

export const STATUS_LABELS: Record<string, string> = {
  idle: 'Ожидание',
  generating_script: 'Генерация сценария...',
  searching_stock: '🔍 Подбираю стоки...',
  script_ready: 'Сценарий готов',
  generating_images: 'Генерация изображений',
  animating: 'Анимация клипов',
  assembling: 'Рендеринг видео',
  done: 'Готово',
  error: 'Ошибка',
};

export const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  generating_script: '#f59e0b',
  searching_stock: '#38bdf8',
  script_ready: '#a78bfa',
  generating_images: '#3b82f6',
  animating: '#60a5fa',
  assembling: '#a78bfa',
  done: '#22c55e',
  error: '#ef4444',
};

/** Цвет по умолчанию для статуса, которого мы ещё не знаем. */
export const UNKNOWN_STATUS_COLOR = '#888888';

/**
 * Подпись статуса. Для незнакомого статуса возвращает сам статус: это
 * некрасиво, но честно, и сразу видно, что список пора дополнить.
 */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Цвет статуса. Для незнакомого — серый, а не `undefined`: подстановка
 * `undefined` в строку цвета ломала подложку значка целиком.
 */
export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? UNKNOWN_STATUS_COLOR;
}
