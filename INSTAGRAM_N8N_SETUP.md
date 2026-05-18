# Instagram N8N Publishing Setup Guide

## Обзор
Данное руководство описывает настройку автоматической публикации в Instagram через N8N workflow с использованием Puppeteer для автоматизации браузера.

## Требования
- N8N сервер с доступом к установке пакетов
- Puppeteer для автоматизации браузера
- Аккаунт Instagram с логином и паролем
- Доступ к Directus для обновления статусов

## Установка зависимостей

### 1. Установка Puppeteer в N8N
```bash
# В контейнере N8N или на сервере
npm install puppeteer
```

### 2. Настройка окружения
Убедитесь что в N8N доступны переменные окружения:
- `DIRECTUS_TOKEN` - для обновления статусов в Directus
- `DIRECTUS_URL` - URL Directus API

## Настройка Workflow

### 1. Импорт workflow
1. Откройте N8N интерфейс
2. Создайте новый workflow
3. Импортируйте содержимое файла `scripts/instagram/instagram-posting-workflow.json`

### 2. Настройка webhook
1. В узле "Instagram Webhook" скопируйте webhook URL
2. URL должен быть вида: `https://your-n8n-domain.com/webhook/publish-instagram`

### 3. Настройка учетных данных
Workflow ожидает учетные данные Instagram в параметрах запроса:
```json
{
  "settings": {
    "username": "your_instagram_username",
    "password": "your_instagram_password"
  }
}
```

## Структура данных

### Входные данные (webhook)
```json
{
  "content": "Текст поста",
  "imageUrl": "https://example.com/image.jpg",
  "contentId": "uuid-content-id",
  "campaignId": "uuid-campaign-id",
  "settings": {
    "username": "instagram_username",
    "password": "instagram_password"
  },
  "hashtags": ["#хэштег1", "#хэштег2"],
  "location": "Название локации",
  "caption": "Полная подпись к посту"
}
```

### Выходные данные
```json
{
  "success": true,
  "platform": "instagram",
  "contentId": "uuid-content-id",
  "campaignId": "uuid-campaign-id",
  "status": "published",
  "postUrl": "https://instagram.com/p/POST_ID/",
  "publishedAt": "2025-01-08T12:00:00.000Z",
  "message": "Пост успешно опубликован в Instagram"
}
```

## Алгоритм работы

### 1. Подготовка данных
- Валидация входных данных
- Проверка наличия изображения и контента
- Подготовка учетных данных

### 2. Автоматизация браузера
- Запуск Puppeteer в headless режиме
- Переход на instagram.com
- Авторизация через форму логина
- Проверка успешности входа

### 3. Публикация контента
- Загрузка изображения с URL
- Создание нового поста через интерфейс
- Загрузка изображения в Instagram
- Добавление подписи и хэштегов
- Публикация поста

### 4. Обновление статуса
- Получение URL опубликованного поста
- Обновление статуса в Directus
- Возврат результата в основное приложение

## Обработка ошибок

### Типичные ошибки и решения:
1. **Ошибка авторизации**: Проверьте логин/пароль, возможна блокировка аккаунта
2. **Селекторы не найдены**: Instagram изменил интерфейс, нужно обновить селекторы
3. **Таймауты**: Увеличить время ожидания или проверить скорость интернета
4. **Блокировка аккаунта**: Использовать менее частые публикации или несколько аккаунтов

### Логирование
Все операции логируются в консоль N8N для отладки:
```javascript
console.log('Подготовка данных для Instagram:', data);
console.log('Instagram публикация результат:', response);
```

## Безопасность

### Рекомендации:
1. **Не хранить пароли в коде** - передавать через настройки кампании
2. **Использовать proxy** для избежания блокировок
3. **Ограничить частоту публикаций** - не более 1 поста в 10 минут
4. **Мониторинг блокировок** - отслеживать ошибки авторизации

## Интеграция с основным приложением

### Webhook URL
После настройки workflow, URL будет:
```
https://your-n8n-domain.com/webhook/publish-instagram
```

### Обновление в коде
В файле `server/api/social-publishing-router.ts` добавлен маршрут:
```javascript
router.post('/publish-instagram', async (req, res) => {
  // Отправка данных на N8N webhook
  const response = await axios.post(INSTAGRAM_WEBHOOK_URL, req.body);
  res.json(response.data);
});
```

## Тестирование

### Тестовый запрос
```bash
curl -X POST https://your-n8n-domain.com/webhook/publish-instagram \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Тестовый пост",
    "imageUrl": "https://example.com/test-image.jpg",
    "contentId": "test-content-id",
    "campaignId": "test-campaign-id",
    "settings": {
      "username": "test_username",
      "password": "test_password"
    }
  }'
```

## Мониторинг

### Проверка статуса workflow
1. Открыть N8N интерфейс
2. Перейти в "Executions"
3. Проверить логи последних выполнений
4. Анализировать ошибки и успешные публикации

### Метрики производительности
- Время выполнения: ~30-60 секунд на пост
- Успешность: зависит от стабильности Instagram
- Ограничения: рекомендуется не более 10 постов в час

## Устранение неполадок

### Частые проблемы:
1. **Puppeteer не запускается**: Проверить установку зависимостей
2. **Селекторы не работают**: Обновить селекторы под новый интерфейс Instagram
3. **Медленная работа**: Оптимизировать настройки Puppeteer
4. **Блокировки**: Добавить случайные задержки и человекоподобное поведение

### Дебаг режим
Для отладки можно запустить Puppeteer в визуальном режиме:
```javascript
const browser = await puppeteer.launch({
  headless: false, // Показать браузер
  devtools: true   // Открыть DevTools
});
```