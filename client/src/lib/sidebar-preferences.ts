/**
 * Память о свёрнутом меню (замечание владельца 31.07.2026).
 *
 * Состояние свёрнутости жило в обычном `useState(false)` внутри AppShell, а
 * AppShell монтируется заново на каждой странице — при переходе состояние
 * создавалось с нуля, и меню «само разворачивалось».
 *
 * Почему отдельный модуль, а не две строки с localStorage прямо в компоненте:
 * обращение к localStorage МОЖЕТ БРОСИТЬ — приватный режим Safari, отключённые
 * cookies, политика хранилища в iframe. Голый `localStorage.getItem` в
 * инициализаторе состояния уронил бы весь AppShell, то есть всё приложение,
 * ради настройки меню. Здесь падение проглатывается и деградирует до значения
 * по умолчанию.
 */

const KEY = 'smm_sidebar_collapsed';

/** Свёрнуто ли меню в прошлый раз. Любая проблема хранилища = «развёрнуто». */
export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Запомнить состояние. Молча ничего не делает, если хранилище недоступно. */
export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    /* хранилище недоступно — настройка просто не переживёт переход */
  }
}
