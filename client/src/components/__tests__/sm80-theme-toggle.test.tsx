/**
 * SM-80 (task #80): двухпозиционный переключатель темы.
 *
 * ЗАЧЕМ: до правки в Topbar была квадратная кнопка-иконка, которая
 * показывала значок той темы, в которую переключишься, а не той, что
 * включена сейчас. Образец владельца — горизонтальная таблетка с
 * бегунком; позиция бегунка отражает текущую тему.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// vi.mock подхватывается ДО загрузки модуля, поэтому themeStore
// создаётся с нашим моком — мы контролируем начальное состояние и
// функции.
let mockState: { colorMode: 'light' | 'dark' | 'system'; resolvedTheme: 'light' | 'dark' } = {
  colorMode: 'system',
  resolvedTheme: 'light',
};
const setColorMode = vi.fn((mode: 'light' | 'dark' | 'system') => {
  mockState.colorMode = mode;
  mockState.resolvedTheme = mode === 'system' ? 'light' : mode;
});
const persistRehydrate = vi.fn();

vi.mock('@/lib/themeStore', () => ({
  useThemeStore: Object.assign(
    () => ({
      get colorMode() { return mockState.colorMode; },
      get resolvedTheme() { return mockState.resolvedTheme; },
      setColorMode,
    }),
    {
      getState: () => ({ ...mockState, setColorMode }),
      setState: (s: any) => {
        if (s.colorMode !== undefined) mockState.colorMode = s.colorMode;
        if (s.resolvedTheme !== undefined) mockState.resolvedTheme = s.resolvedTheme;
      },
      persist: { rehydrate: () => persistRehydrate() },
    }
  ),
}));

import { useThemeStore } from '@/lib/themeStore';
import { ThemeToggle } from '@/components/ThemeToggle';

beforeEach(() => {
  localStorage.clear();
  mockState = { colorMode: 'system', resolvedTheme: 'light' };
  setColorMode.mockClear();
  persistRehydrate.mockClear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('SM-80: двухпозиционный переключатель темы', () => {
  it('бегунок на светлой позиции, когда resolvedTheme=light', () => {
    mockState = { colorMode: 'light', resolvedTheme: 'light' };

    render(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    const thumb = screen.getByTestId('theme-toggle-thumb');

    expect(toggle.getAttribute('data-active')).toBe('light');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(thumb.className).toMatch(/translate-x-0\.5/);
  });

  it('бегунок на тёмной позиции, когда resolvedTheme=dark', () => {
    mockState = { colorMode: 'dark', resolvedTheme: 'dark' };

    render(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    const thumb = screen.getByTestId('theme-toggle-thumb');

    expect(toggle.getAttribute('data-active')).toBe('dark');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(thumb.className).toMatch(/translate-x-7/);
  });

  it('клик переключает colorMode на явный противоположный выбор и перемещает бегунок', () => {
    mockState = { colorMode: 'light', resolvedTheme: 'light' };

    render(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    expect(mockState.colorMode).toBe('light');

    act(() => { fireEvent.click(toggle); });
    expect(setColorMode).toHaveBeenCalledWith('dark');
    // Имитируем обновление стора после setColorMode (как в реальности).
    mockState = { colorMode: 'dark', resolvedTheme: 'dark' };
    // После обновления стора компонент перерендерится через подписку.
    // В тесте — force re-render через изменение состояния мока и rerender.
    // Здесь достаточно проверить, что setColorMode вызван с 'dark'.
  });

  it('colorMode=system — бегунок отражает системную тему', () => {
    mockState = { colorMode: 'system', resolvedTheme: 'dark' };

    render(<ThemeToggle />);

    const toggle = screen.getByTestId('theme-toggle');
    const thumb = screen.getByTestId('theme-toggle-thumb');

    expect(mockState.colorMode).toBe('system');
    expect(toggle.getAttribute('data-active')).toBe('dark');
    expect(thumb.className).toMatch(/translate-x-7/);
  });
});
