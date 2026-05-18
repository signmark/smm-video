import { useEffect, useState } from 'react';

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          auth_date?: number;
          hash?: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
        };
        colorScheme: 'light' | 'dark';
      };
    };
  }
}

export function useTelegramWebApp() {
  const [webApp, setWebApp] = useState<any>(null);
  const [isInTelegram, setIsInTelegram] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Проверяем, запущено ли приложение в Telegram
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      
      // Инициализируем WebApp
      tg.ready();
      
      // НЕ делаем автоматический expand - каждая страница сама решает
      // tg.expand(); - убрано
      
      setWebApp(tg);
      setIsInTelegram(true);
      setUser(tg.initDataUnsafe?.user || null);
    }
  }, []);

  return {
    webApp,
    isInTelegram,
    user,
    initData: webApp?.initData,
    initDataUnsafe: webApp?.initDataUnsafe,
    colorScheme: webApp?.colorScheme,
    themeParams: webApp?.themeParams
  };
}
