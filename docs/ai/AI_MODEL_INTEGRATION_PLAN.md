# AI модели в SMM Manager

**Дата последнего обновления:** 10 июля 2026

## Текущие модели

### Доступны в UI для генерации контента

| Модель | Сервис | Рекомендация |
|--------|--------|--------------|
| Gemini 3.5 Flash ⚡ | Google (через Cloudflare proxy) | **По умолчанию.** Быстрый, экономичный, хорошее качество |
| Gemini 3.0 Pro | Google (через Cloudflare proxy) | Высокое качество, медленнее Flash |
| Gemini 2.5 Pro | Google (через Cloudflare proxy) | Проверенная модель |
| Gemini 2.5 Flash | Google (через Cloudflare proxy) | Быстрая и дешёвая |
| DeepSeek | DeepSeek API | Хорош для технических текстов |
| Qwen | Alibaba Cloud | Хорош для многоязычного контента |

### Fallback-цепочка

При ошибке 429/quota/503/UNAVAILABLE модель автоматически переключается:

```
Gemini → DeepSeek → Qwen
```

Ответ содержит `isFallback: true, originalService` для отображения на фронте.

### Claude — НЕ ДОСТУПЕН

Claude удалён из UI генерации контента. Серверный код (`services/claude.ts`, `routes-claude.ts`) остался как мёртвый код. Claude доступен только в настройках API-ключа (SettingsDialog), но не используется для генерации.

## Архитектура AI-интеграции

### Серверные компоненты

- `server/services/ai-service.ts` — единый сервис для всех AI-моделей
- `server/services/claude.ts` — мёртвый код (Claude API)
- `server/routes/ai.ts` — эндпоинт `/api/generate-content` и `/api/generate`
- `server/routes/gemini-routes.ts` — Gemini-specific маршруты

### Проксирование

Все Gemini-вызовы идут через Cloudflare Worker proxy (`GEMINI_PROXY_URL`). Прямое использование `google-auth-library` запрещено.

### Клиентские компоненты

Три точки входа для генерации контента:

1. **`ContentGenerationDialog.tsx`** — полный диалог из настроек кампании
2. **`ContentGenerationPanel.tsx`** — панель на странице кампании
3. **Inline AI-панель** в `content/index.tsx` — в диалоге «Создание нового контента»

Каждая поддерживает: выбор модели, тон, ключевые слова, данные кампании, соответствие стилю.

## Рекомендации по использованию

| Задача | Рекомендуемая модель |
|--------|---------------------|
| Быстрая генерация постов | Gemini 3.5 Flash |
| Высокое качество текста | Gemini 3.0 Pro |
| Технические описания | DeepSeek |
| Многоязычный контент | Qwen |
| Экономия бюджета | Gemini 2.5 Flash |

## Метрики (ориентировочные)

| Модель | Скорость (500 слов) | Стоимость |
|--------|---------------------|-----------|
| Gemini 3.5 Flash | ~1-2 сек | Низкая |
| Gemini 3.0 Pro | ~3-5 сек | Средняя |
| Gemini 2.5 Flash | ~1-3 сек | Низкая |
| DeepSeek | ~3-5 сек | Низкая |
| Qwen | ~2-6 сек | Средняя |

## История изменений

- **10.07.2026** — Удалены ссылки на Claude как доступную модель
- **2025** — Добавлены Gemini 3.5 Flash, Gemini 3.0 Pro
- **2025** — Переход на Cloudflare proxy для Gemini
- **2024** — Базовая интеграция Gemini, DeepSeek, Qwen
