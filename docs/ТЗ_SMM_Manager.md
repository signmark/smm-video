# ТЗ: SMM Manager — описание текущей реализации

## 1. Стек и инфраструктура

**Runtime:** Node.js 20, TypeScript  
**Frontend:** React 18, Vite 5, TailwindCSS, shadcn/ui, wouter, TanStack Query  
**Backend:** Express 4, единый порт 5000 (фронт + API)  
**БД:** PostgreSQL через Directus (headless CMS)  
**Auth:** Directus (JWT access_token + refresh_token)  
**Хранилище:** Beget S3 (AWS SDK v3) для изображений  
**AI:** Gemini 2.5 Flash/Pro (основной), Claude (fallback), DeepSeek, Qwen  
**Изображения:** Vertex AI (Nanobanana), FAL.AI (Flux, Juggernaut XL)  
**Оркестрация:** N8N (Docker) — сбор трендов, часть публикаций  
**Dev:** Replit (порт 5000) | **Prod:** VPS smm.omemo.tech  
**Directus Dev:** https://directus.roboflow.space | **Prod:** https://directus.nplanner.ru  

---

## 2. Аутентификация

### Поток входа
1. Клиент POST `/api/auth/login` → сервер проксирует в Directus `/auth/login`
2. Directus возвращает `access_token`, `refresh_token`, `expires_at`
3. Сервер создаёт сессию в `DirectusAuthManager` (in-memory кэш, keyed by userId)
4. Клиент сохраняет токены в `localStorage`: `auth_token`, `refresh_token`
5. `useAuthStore` (Zustand) обновляется, пользователь считается авторизованным

### Обновление токена
- **Фронтенд:** `setTimeout` на 80% от времени жизни токена → вызов `/api/auth/refresh`
- **Фронтенд fallback:** `setInterval` каждые 10 минут
- **Сервер:** middleware `authenticateUser` при 401 сам пытается `directusAuthManager.refreshSession(userId)`
- **После успешного refresh:** новые токены сохраняются в Directus (`telegramSessionStorage`) — для фонового autonomous режима

### Middleware
- `server/middleware/user-auth.ts` (`authenticateUser`) — основной: читает токен из `Authorization` header, декодирует JWT, при истечении пытается refresh
- `server/middleware/auth.ts` (`authMiddleware`) — упрощённый: только декодирует JWT, используется в части роутов

### Регистрация
POST `/api/auth/register` → сервер через admin-токен создаёт пользователя в Directus с ролью `smmUserRoleId`

### Ключевые файлы
- `client/src/hooks/use-auth.tsx` — loginMutation, useAuth
- `client/src/lib/auth.ts` — tokenRefresh, startRefreshInterval
- `client/src/lib/refreshAuth.ts` — refreshAuthToken (восстановление из localStorage)
- `server/api/auth-routes.ts` — /api/auth/login, /refresh, /logout
- `server/middleware/user-auth.ts` — authenticateUser
- `server/services/directus-auth-manager.ts` — DirectusAuthManager (сессионный кэш)

---

## 3. Кампании

### Хранение
Коллекция `user_campaigns` в Directus (PostgreSQL). Доступ через:
- Прямые запросы с **admin-токеном** + фильтр `filter[user_id][_eq]=${userId}`
- Пользовательский токен возвращает 403 — у пользователей нет прямого чтения коллекции

### Структура записи
| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | Первичный ключ |
| `name` / `title` | string | Название кампании |
| `description` | string | Описание |
| `link` | string | URL сайта компании |
| `user_id` | UUID | Владелец |
| `social_media_settings` | JSON | Токены и ID для всех платформ |
| `autonomous_settings` | JSON | Настройки AI-автономного режима |
| `trend_analysis_settings` | JSON | Параметры сбора трендов |

### `social_media_settings` — по платформам
- **Telegram:** `token`, `chatId`
- **VK:** `token`, `refreshToken`, `clientId`, `deviceId`, `groupId`, `groupName`, `tokenExpiresAt`, `tokenRefreshedAt`, `authExpired`
- **Instagram:** `accessToken`, `businessAccountId`, `appId`, `appSecret`
- **Facebook:** `token` (page token), `pageId`, `pageName`
- **YouTube:** `channelId`, `channelTitle`, `accessToken`, `refreshToken`
- **Threads / TikTok:** OAuth-токены

### `autonomous_settings`
| Поле | Тип | Описание |
|------|-----|----------|
| `globalPrompt` | string | Системный промпт AI |
| `alwaysInclude` | string | Текст/ссылки всегда в конце поста |
| `signature` | string | Подпись |
| `useEditorPass` | bool | AI-редактирование перед публикацией |
| `humanize` | bool | «Очеловечивание» текста |
| `adaptForPlatforms` | bool | Платформенная адаптация |
| `autoSchedule` | bool | Автоматическое расписание |
| `postsPerCycle` | number | Постов за один цикл |
| `intervalHours` | number | Интервал между циклами (часы) |
| `withImages` | bool | Генерировать изображения |
| `pipelineMode` | enum | `full_auto` / `controlled` / `mixed` |

### `trend_analysis_settings`
| Поле | Тип | Описание |
|------|-----|----------|
| `minFollowers` | object | Минимум подписчиков: `{instagram, telegram, vk, facebook, youtube}` |
| `minViews` | number | Порог просмотров для тренда |
| `maxSourcesPerPlatform` | number | Макс. источников на платформу |
| `maxTrendsPerSource` | number | Макс. трендов из источника |
| `collectionDays` | number | Глубина сбора (дней назад) |

### Создание кампании (Wizard)
1. Создать базовую запись (`POST /api/campaigns`)
2. Анализ сайта (`web-crawler-agent.ts`) — извлекает бизнес-инфо
3. Заполнить анкету (`business_questionnaire`) — автоматически через AI
4. Сгенерировать ключевые слова (`campaign_keywords`)

### Связанные коллекции
- `business_questionnaire` — детальный профиль бизнеса (аудитория, ценности, УТП)
- `campaign_keywords` — ключевые слова для поиска трендов
- `campaign_content` — черновики, запланированные и опубликованные посты
- `campaign_content_sources` — источники трендов (каналы, группы)
- `campaign_trend_topics` — собранные тренды

### Ключевые файлы
- `server/routes/campaigns.ts` — CRUD /api/campaigns
- `client/src/components/CampaignForm.tsx` — Wizard создания
- `client/src/pages/campaigns/[id].tsx` — страница кампании

---

## 4. Контент

### Структура (`campaign_content`)
| Поле | Тип | Описание |
|------|-----|----------|
| `text_content` / `content` | string | Текст поста |
| `title` | string | Заголовок (3–6 слов) |
| `image_url` | string | URL основного изображения (S3) |
| `video_url` | string | URL видео |
| `additional_images` | JSON | Дополнительные изображения |
| `status` | enum | `draft` → `scheduled` → `published` / `failed` |
| `social_platforms` | JSON | Статус по каждой платформе |
| `campaign_id` | UUID | Кампания |

### `social_platforms` — структура на платформу
```json
{
  "vk": {
    "status": "published",
    "scheduledAt": "2026-05-20T10:00:00.000Z",
    "postId": "wall-175959583_79",
    "postUrl": "https://vk.com/wall-...",
    "retryCount": 0,
    "publishedAt": "2026-05-20T10:01:05.000Z"
  },
  "telegram": { ... },
  "facebook": { ... }
}
```

### Генерация текста
1. Контекст: анкета бизнеса + ключевые слова + тренды
2. Генерация: Gemini 2.5 Flash → Claude / DeepSeek (fallback)
3. Санитизация: удаление Markdown, HTML, «разговорных» вставок AI
4. Заголовок: отдельный вызов AI, 3–6 слов
5. Сохранение в `campaign_content` со статусом `draft`

### Генерация изображений
| Провайдер | Модели | Применение |
|-----------|--------|------------|
| Vertex AI (Nanobanana) | Imagen | Основной, быстрый |
| FAL.AI | Flux Schnell/Dev/Pro, Juggernaut XL, SDXL | Специфические стили |
| OpenAI | DALL-E 3 | Legacy/fallback |

- Параметры: стиль из промпта, aspect ratio, размеры кратные 64
- Результат → загрузка в Beget S3, URL → `image_url`

### Ключевые файлы
- `server/services/ai-service.ts` — генерация текста
- `server/services/fal-ai-universal.ts` — генерация изображений (FAL)
- `server/services/ai-assistant/command-handlers.ts` — генерация из анкеты/кампании

---

## 5. Планировщик публикаций

### Цикл
Singleton `PublishScheduler`. Тик каждые **30 секунд**.  
Фильтр: контент со статусами `scheduled`, `partial`, `pending`, `partially_published`, у которых `social_platforms[platform].scheduledAt <= now`.

### Защита от дублей (4 уровня)
| Уровень | Механизм | Где |
|---------|----------|-----|
| 1 | `processedContentCache` — in-memory Set | Локальный кэш в процессе |
| 2 | `publicationTracker.canPublish` | Персистентная проверка в БД |
| 3 | `publicationLockManager` | In-memory mutex, таймаут 15 мин |
| 4 | `atomicSave` | Promise-mutex при записи `social_platforms` |

### Адаптация контента перед публикацией
Если `useEditorPass: true`: AI (Gemini) адаптирует текст под платформу:
- Threads: обрезка до 500 символов
- Telegram: Markdown → HTML
- Instagram: удаление ссылок из текста

### Ретраи
- До **3 попыток** с интервалом **5 минут** (`scheduledAt = now + 5min`)
- **Auth-ошибки** → сразу `failed`, уведомление пользователю, без ретраев
- **Зависший `publishing` > 30 мин** → автосброс в `pending`

### Поддерживаемые платформы
| Платформа | Метод публикации |
|-----------|-----------------|
| Telegram | Прямой API (Telegraf) — текст, фото, видео |
| VK | Прямой API — wall.post, photo/video upload |
| VK Stories | `vk-stories-service` |
| VK Clips | `vk-clips-service` |
| Instagram | Graph API — feed posts |
| Instagram Reels | `instagram-reels-service` |
| Facebook | Graph API — страница |
| Threads | Прямой API |
| YouTube | N8N webhook |
| TikTok | Content Posting API |

### Ключевые файлы
- `server/services/publish-scheduler.ts` — основной цикл
- `server/services/publication-lock-manager.ts` — locking
- `server/services/publication-tracking.ts` — персистентный трекер
- `server/api/social-publishing-router.ts` — роутинг по платформам

---

## 6. Публикация VK

### OAuth-потоки
| Вид | Endpoint | Провайдер |
|-----|----------|-----------|
| VK ID v2 (основной) | `/api/vk/oauth2/callback` | `id.vk.com/oauth2/auth` → `access_token` + `refresh_token` + `device_id` |
| Legacy | `/api/vk/callback` | `oauth.vk.com` с `scope=wall,photos,video,groups,offline` |
| Webhook-прокси | `/api/vk/token-webhook/:campaignId` | Принимает токен от клиента (vk.needanapp.ru) — обход IP-binding |

### Жизненный цикл токена
```
Авторизация → сохранение {token, refreshToken, deviceId, tokenExpiresAt} 
       ↓
Фоновый кron (каждые 6 ч): refreshAllExpiringVkTokens
  → обновляет токены с tokenExpiresAt < now + 26 часов
       ↓
При публикации: если tokenExpiresAt < now + 5 мин → проактивный refresh
       ↓
Если VK вернул ошибку 5 → реактивный refresh + retry
       ↓
Если invalid_grant → authExpired: true + уведомление пользователю
```

### Публикация поста
1. Санитизация: strip HTML + Markdown → plain text
2. Загрузка фото: `photos.getWallUploadServer` → POST multipart → `photos.saveWallPhoto`
3. Загрузка видео: `video.save` → POST binary → attachment string
4. `wall.post` с текстом + attachments
5. Retry при VK error 10 (internal server error): до 3 раз, exponential backoff

### Ключевые файлы
- `server/routes/vk.ts` — OAuth callbacks и webhook
- `server/services/social-platforms/vk-service.ts` — логика публикации
- `server/services/vk-token-refresh.ts` — фоновый refresh + уведомления

---

## 7. Автономный режим

### Принцип
Фоновый процесс на сервере. Для каждой активной кампании — отдельный `setInterval`.  
При старте сервера — `restoreAutonomousStates()` восстанавливает все активные сессии.

### Хранение сессий
- **Основное:** Directus `autonomous_sessions` (PostgreSQL), `is_active: true`
- **Fallback:** `data/autonomous-states.json` (локальный файл)

### Один цикл (8 фаз)
| Фаза | Действие |
|------|----------|
| 1 | **Аналитика** — ER, топ-темы, лучшее время за 7 дней |
| 2 | **Тренды** — сбор из источников, скоринг по engagement |
| 3 | **Контекст** — ключевые слова + globalPrompt + alwaysInclude + подпись |
| 4 | **План** — AI генерирует N тем (N = postsPerCycle) |
| 5 | **Дедупликация** — сверка с последними 30 опубликованными |
| 6 | **Согласование** — пауза если pipelineMode = controlled |
| 7 | **Генерация текста** — humanize + платформенная адаптация |
| 8 | **Изображения + Расписание** — постановка в очередь или публикация |

### Режимы pipeline
| Режим | Поведение |
|-------|-----------|
| `full_auto` | Полная автоматика, без остановок |
| `controlled` | 3 точки одобрения: план → текст → изображения |
| `mixed` | Без одобрения для 1 поста, с одобрением для крупных планов |

### Инструменты AI-ассистента (28 штук)
`createCampaign`, `crawlWebsite`, `getCampaignData`, `getKeywordsFromWebsite`, `collectTrends`, `getTrendsData`, `createContent`, `getAnalytics`, `saveData`, `generateKeywords`, `getContentList`, `unpublishContent`, `removeDuplicatePosts`, `saveKeywordsToCampaign`, `getCampaignKeywords`, `readQuestionnaire`, `fillQuestionnaire`, `startScheduler`, `stopScheduler`, `smartSearchTelegramChannels`, `scheduleContent`, `generateHashtags`, `webSearch`, `startAutonomous`, `stopAutonomous`, `getAutonomousStatus`, `rewriteContent`, `generateImage`

### Ключевые файлы
- `server/services/autonomous-ai.ts` — основной движок, TOOL_IMPLEMENTATIONS
- `server/services/ai-assistant/autonomous.ts` — Function Calling, intent routing
- `client/src/components/AutonomousSettings.tsx` — UI настроек
- `client/src/components/ContentPlanApproval.tsx` — UI согласования плана

---

## 8. Сбор трендов

### Триггер
- Вручную: кнопка «Собрать источники / тренды» → POST `/api/trends/collect`
- Автоматически: фаза 2 автономного цикла

### Поток
```
POST /api/trends/collect
  → читает trend_analysis_settings кампании из Directus (admin token)
  → формирует payload со всеми параметрами (включая minFollowers)
  → POST N8N webhook "collect-trends" (fire-and-forget, timeout 15s)
       ↓ если N8N недоступен — fallback:
  → directusCrud.list('campaign_content_sources') — получает источники кампании
  → scraper API (217.26.25.95:3030) — запрашивает тренды по платформам
  → нормализация постов, подсчёт engagementScore
  → сохранение в campaign_trend_topics
```

### Payload для N8N (полный)
```json
{
  "campaignId": "...",
  "userID": "...",
  "platforms": ["instagram", "telegram", "vk"],
  "keywords": ["..."],
  "collectSources": true,
  "collectComments": [],
  "collectionDays": 7,
  "day_past": 7,
  "minViews": 500,
  "maxTrendsPerSource": 5,
  "maxSourcesPerPlatform": 10,
  "minFollowers": {
    "instagram": 5000,
    "telegram": 2000,
    "vk": 3000,
    "facebook": 5000,
    "youtube": 10000
  }
}
```
Приоритет значений: `req.body` → `trend_analysis_settings` кампании из БД → хардкодные дефолты

### Scraper API (`217.26.25.95:3030`)
| Endpoint | Платформа |
|----------|-----------|
| `/api/telegram/trending-posts` | Telegram |
| `/api/vk/trending-posts` | VK |
| `/api/youtube/trending-videos` | YouTube |
| `/api/instagram/instagram/collect-and-get-trending` | Instagram |

Авторизация: global API key `telegram_collect_comments` из `global_api_keys` в Directus

### Хранение (`campaign_trend_topics`)
`title`, `description`, `urlPost`, `sourceType` (платформа), `views`, `reactions`, `comments`, `engagementScore`, `raw_source_data`

AI-анализ тональности: Gemini анализирует комментарии → sentiment score

### Источники (`campaign_content_sources`)
- Поддерживаемые платформы: Telegram, VK, YouTube, Instagram
- Типы: keyword-based (найдены автоматически) и manual (добавлены вручную)

### Ключевые файлы
- `server/api/trends-routes.ts` — /api/trends/collect и остальные endpoints
- `server/services/trend-collector.ts` — fallback-сбор через scraper
- `server/services/daily-trend-scheduler.ts` — ежедневный автосбор

---

## 9. AI-ассистент (чат)

### Режимы работы
| Режим | Описание |
|-------|----------|
| Прямые команды | Распознаёт намерение → вызывает один инструмент |
| Function Calling | Gemini сам выбирает цепочку инструментов из 28 доступных |
| Автономный режим | AI ведёт полный SMM-цикл самостоятельно |

### История диалога
- Хранится в Directus `ai_conversation_messages`, keyed by `user_id`
- Лимит: последние 10 сообщений (старые автоматически удаляются)

### Ключевые файлы
- `server/services/ai-assistant/` — все команды и роутинг
- `server/api/ai-assistant-routes.ts` — API endpoints
- `client/src/components/AIChat.tsx` — UI чата

---

## 10. Telegram-бот

- Библиотека: Telegraf
- Webhook на продакшн-домене (в dev режиме — 401 ожидаемо)
- Основной интерфейс: **Telegram Mini App** (WebApp внутри Telegram)
- Сессии пользователей синхронизированы с `DirectusAuthManager`
- Уведомления пользователю:
  - Истёкший VK токен → переподключиться
  - Результаты публикации

### Ключевые файлы
- `server/telegram-bot/` — вся логика бота
- `server/services/telegram-session-storage.ts` — персистентные сессии

---

## 11. API-ключи

### Приоритет загрузки
1. `global_api_keys` в Directus (admin token) — per-service ключи
2. `.env` / Replit Secrets — fallback

### Сервисы
`gemini`, `anthropic`, `openai`, `fal_ai`, `deepseek`, `qwen`, `HUGGINGFACE_API_KEY`, `TELEGRAM_COLLECT_COMMENTS`, `PEXELS_API_KEY`, и др.

### Ключевые файлы
- `server/services/global-api-keys.ts` — чтение из Directus
- `server/services/load-keys.ts` — маппинг в env переменные

---

## 12. Аналитика

- Статистика публикаций по платформам (из `social_platforms` поля контента)
- ER (engagement rate) по кампании за период
- Лучшее время публикации (анализ исторических данных)
- Используется в фазе 1 автономного цикла

---

## 13. Directus как backend

Directus выполняет роль:
- **Auth-провайдера** (JWT, RBAC, роли пользователей)
- **ORM/БД** (все коллекции — PostgreSQL под капотом)
- **Хранилища** медиафайлов (опционально, основное — S3)

### Доступ из кода
- **Admin-токен** (`DIRECTUS_ADMIN_TOKEN` env var, статический) — для системных операций
- **User-токен** — для операций от имени пользователя (где Directus RBAC это разрешает)
- Класс `DirectusCrud` (`server/services/directus-crud.ts`) — единый сервис для CRUD с retry-логикой (3 попытки, exponential backoff, retry на 502/503/504/429)

### Важное правило
Коллекция `user_campaigns` недоступна через user-токен (403). Все чтения — только через admin-токен + `filter[user_id][_eq]=${userId}`.
