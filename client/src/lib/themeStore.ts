import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Типы для цветовых тем
export type ColorMode = 'light' | 'dark' | 'system';

// Функция для определения системной темы
const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light'; // fallback для серверного рендеринга
};

// Функция для получения фактической темы
const getResolvedTheme = (colorMode: ColorMode): 'light' | 'dark' => {
  if (colorMode === 'system') {
    return getSystemTheme();
  }
  return colorMode;
};

// Интерфейс для хранилища тем
interface ThemeState {
  // Основной режим (светлый/темный/системный)
  colorMode: ColorMode;
  
  // Фактическая тема (без 'system')
  resolvedTheme: 'light' | 'dark';
  
  // Методы изменения состояния
  setColorMode: (mode: ColorMode) => void;
  
  // Синхронизация с системной темой
  syncSystemTheme: () => void;
  
  // Сбросить на дефолтные настройки
  resetToDefault: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Начальные значения - автоматически определяем системную тему
      colorMode: 'system' as ColorMode,
      resolvedTheme: getSystemTheme(),
      
      // Методы изменения
      setColorMode: (mode: ColorMode) => {
        const resolvedTheme = getResolvedTheme(mode);
        set({ colorMode: mode, resolvedTheme });
        console.log(`🎨 Theme changed to: ${mode}${mode === 'system' ? ` (resolved: ${resolvedTheme})` : ''}`);
      },
      
      // Синхронизация с системной темой (для случаев когда пользователь меняет тему ОС)
      syncSystemTheme: () => {
        const current = get();
        if (current.colorMode === 'system') {
          const systemTheme = getSystemTheme();
          if (current.resolvedTheme !== systemTheme) {
            set({ resolvedTheme: systemTheme });
            console.log(`🔄 System theme changed to: ${systemTheme}`);
          }
        }
      },
      
      // Сброс к дефолтным настройкам (системная тема)
      resetToDefault: () => {
        const systemTheme = getSystemTheme();
        set({ 
          colorMode: 'system' as ColorMode,
          resolvedTheme: systemTheme
        });
      }
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

