/**
 * SM-80: двухпозиционный переключатель темы — таблетка на два значка.
 *
 * ЗАЧЕМ: нынешняя кнопка в Topbar показывала значок той темы, в которую
 * переключишься, а не той, что включена сейчас. Это сбивает с толку.
 * Образец владельца — горизонтальная таблетка на две позиции: оба
 * значка (Sun/Moon) видны одновременно, белый круглый бегунок
 * скользит между ними, и его позиция отражает текущую тему.
 *
 * Поведение:
 * — бегунок всегда на позиции текущей `resolvedTheme` (light/dark).
 * — клик ставит явный выбор (light или dark) и сохраняет в store.
 * — режим «как в системе» живёт как умолчание до первого касания;
 *   отдельного элемента возврата в интерфейсе нет — владелец решил
 *   22.08, что он не нужен.
 *
 * ОГРАНИЧЕНИЯ:
 * — Не использовать квадратную кнопку-иконку с Moon/Sun в зависимости
 *   от `resolvedTheme` — это ровно то поведение, которое образец
 *   заменил.
 * — Не показывать третий значок (Monitor). Состояние «как в системе»
 *   в Topbar не представлено, чтобы не плодить третий вариант.
 */
import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '@/lib/themeStore';

export function ThemeToggle() {
  const { resolvedTheme, setColorMode } = useThemeStore();
  const isDark = resolvedTheme === 'dark';

  const handleClick = () => {
    // Клик переключает на явный противоположный выбор. После первого
    // касания режим «как в системе» больше не выбирается — так решено.
    setColorMode(isDark ? 'light' : 'dark');
  };

  // data-testid — для теста: тест смотрит на aria-checked и текущий
  // data-active, чтобы доказать, что позиция бегунка соответствует
  // теме, а не наоборот.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Текущая тема: тёмная. Нажмите, чтобы переключить на светлую.' : 'Текущая тема: светлая. Нажмите, чтобы переключить на тёмную.'}
      onClick={handleClick}
      data-testid="theme-toggle"
      data-active={isDark ? 'dark' : 'light'}
      className={[
        // Базовая «таблетка»: фиксированная ширина, серая заливка,
        // скругление, относительное позиционирование для бегунка.
        'relative inline-flex h-7 w-14 items-center rounded-full',
        'bg-slate-200 dark:bg-slate-700',
        'border border-slate-300 dark:border-slate-600',
        'transition-colors',
      ].join(' ')}
    >
      {/* Левый значок (Sun) — виден всегда. В тёмной теме приглушён,
          в светлой активен (на нём бегунок). */}
      <Sun
        className={[
          'absolute left-1.5 h-3.5 w-3.5',
          'text-amber-500',
          isDark ? 'opacity-40' : 'opacity-100',
          'transition-opacity',
        ].join(' ')}
        aria-hidden="true"
      />
      {/* Правый значок (Moon) — виден всегда. В светлой теме
          приглушён, в тёмной активен. */}
      <Moon
        className={[
          'absolute right-1.5 h-3.5 w-3.5',
          'text-slate-600 dark:text-slate-300',
          isDark ? 'opacity-100' : 'opacity-40',
          'transition-opacity',
        ].join(' ')}
        aria-hidden="true"
      />
      {/* Белый круглый бегунок. Скользит между двумя позициями в
          зависимости от resolvedTheme. Тень добавляет глубину и
          соответствует образцу. */}
      <span
        data-testid="theme-toggle-thumb"
        className={[
          'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow',
          'transition-transform duration-200 ease-out',
          isDark ? 'translate-x-7' : 'translate-x-0.5',
        ].join(' ')}
        aria-hidden="true"
      />
    </button>
  );
}
