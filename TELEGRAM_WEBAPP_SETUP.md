# Настройка Telegram Mini App (Web App)

SMM Manager теперь доступен как веб-приложение внутри Telegram! Это позволяет пользователям работать с полным функционалом системы прямо в мессенджере.

## Настройка через BotFather

### Шаг 1: Откройте BotFather
1. Откройте Telegram
2. Найдите бота [@BotFather](https://t.me/BotFather)
3. Запустите его командой `/start`

### Шаг 2: Настройте Web App URL
1. Отправьте команду `/setmenubutton`
2. Выберите вашего бота из списка
3. Нажмите **Configure menu button**
4. Введите текст кнопки: `🌐 Открыть приложение`
5. Введите URL: `https://235af634-d07e-4e4f-adac-cb79d2f17188-00-3anjk1sbligze.sisko.replit.dev`

### Шаг 3: Проверьте работу
1. Откройте вашего бота в Telegram
2. В меню рядом с полем ввода должна появиться кнопка **🌐 Открыть приложение**
3. Нажмите на неё - откроется веб-приложение SMM Manager

## Доступные способы запуска

### 1. Кнопка в главном меню бота
После авторизации в боте (`/login`) в главном меню появится кнопка **🌐 Открыть веб-приложение**

### 2. Кнопка меню (после настройки в BotFather)
Кнопка рядом с полем ввода сообщений

### 3. Прямая ссылка
`https://235af634-d07e-4e4f-adac-cb79d2f17188-00-3anjk1sbligze.sisko.replit.dev`

## Особенности Telegram Web App

- ✅ **Автоматическая аутентификация** - приложение автоматически получает данные пользователя от Telegram
- ✅ **Адаптивный дизайн** - интерфейс подстраивается под тему Telegram (светлая/тёмная)
- ✅ **PWA поддержка** - работает офлайн и может быть установлено на домашний экран
- ✅ **Нативные кнопки** - BackButton и MainButton интегрированы с Telegram
- ✅ **Полный функционал** - все возможности веб-версии доступны в Telegram

## Технические детали

### Frontend Integration
Приложение использует хук `useTelegramWebApp` для интеграции с Telegram:

```typescript
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp';

function MyComponent() {
  const { isInTelegram, user, webApp } = useTelegramWebApp();
  
  if (isInTelegram) {
    console.log('Running in Telegram!');
    console.log('User:', user);
  }
  
  return <div>...</div>;
}
```

### Available API
- `isInTelegram` - проверка, запущено ли в Telegram
- `user` - данные пользователя Telegram
- `webApp` - полный API Telegram WebApp
- `initData` - зашифрованные данные для аутентификации
- `colorScheme` - текущая тема ('light' | 'dark')
- `themeParams` - параметры темы Telegram

## Обновление URL после деплоя

При деплое проекта URL может измениться. Обновите его в:
1. BotFather (команда `/setmenubutton`)
2. Переменной окружения `API_BASE_URL` (если используется)

## Troubleshooting

### Кнопка не появляется
- Убедитесь, что вы авторизованы в боте (`/login`)
- Попробуйте команду `/menu` для обновления

### Приложение не открывается
- Проверьте, что URL настроен правильно в BotFather
- Убедитесь, что сервер запущен и доступен
- Проверьте консоль браузера на ошибки

### Автоаутентификация не работает
- Убедитесь, что скрипт `telegram-web-app.js` загружен
- Проверьте, что `window.Telegram.WebApp` доступен
- Посмотрите логи в консоли браузера
