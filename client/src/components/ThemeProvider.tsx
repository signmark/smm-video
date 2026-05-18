import React, { useEffect } from 'react';
import { useThemeStore } from '@/lib/themeStore';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { resolvedTheme, syncSystemTheme } = useThemeStore();
  
  // Переключаем класс темы на document.documentElement
  useEffect(() => {
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [resolvedTheme]);
  
  // Слушаем изменения системной темы
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      syncSystemTheme();
    };
    
    // Современный способ подписки на изменения
    mediaQuery.addEventListener('change', handleChange);
    
    // Инициализация при первом запуске
    syncSystemTheme();
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [syncSystemTheme]);
  
  return <>{children}</>;
}