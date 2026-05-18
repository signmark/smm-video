import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore, type ColorMode } from '@/lib/themeStore';

export function ThemeSwitcher() {
  const { 
    colorMode, 
    resolvedTheme,
    setColorMode
  } = useThemeStore();
  
  const toggleColorMode = () => {
    // Циклически переключаем: light → dark → system → light
    if (colorMode === 'light') {
      setColorMode('dark');
    } else if (colorMode === 'dark') {
      setColorMode('system');
    } else {
      setColorMode('light');
    }
  };

  const getIcon = () => {
    if (colorMode === 'system') {
      return <Monitor className="h-5 w-5" />;
    }
    return resolvedTheme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />;
  };

  const getLabel = () => {
    if (colorMode === 'light') return 'Переключить на темную тему';
    if (colorMode === 'dark') return 'Переключить на системную тему';
    return 'Переключить на светлую тему';
  };
  
  return (
    <div className="flex items-center">
      {/* Переключатель: Светлая → Темная → Системная */}
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={toggleColorMode}
        aria-label={getLabel()}
        title={`Текущая тема: ${
          colorMode === 'system' 
            ? `Системная (${resolvedTheme === 'dark' ? 'темная' : 'светлая'})` 
            : colorMode === 'dark' ? 'Темная' : 'Светлая'
        }`}
      >
        {getIcon()}
      </Button>
    </div>
  );
}