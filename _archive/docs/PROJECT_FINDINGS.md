# Находки по проекту SMM Manager

Дата изучения: 2026-04-13

## 1. Общее назначение проекта

SMM Manager — крупная платформа для управления SMM-процессами: кампании, генерация контента с ИИ, планирование публикаций, мультиплатформенная публикация, аналитика, Telegram-бот и Telegram Mini App.

Основная идея системы: пользователь создаёт кампанию, заполняет/получает бизнес-контекст, генерирует контент и изображения, планирует публикации, а система публикует материалы через внешние workflow и собирает статусы/аналитику обратно.

## 2. Технологический стек

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui / Radix UI
- Wouter для маршрутизации
- TanStack React Query для серверного состояния
- Zustand / локальные store-файлы для части клиентского состояния
- Tiptap для rich text editing
- Recharts / Nivo для графиков

### Backend

- Node.js 20+
- Express
- TypeScript
- tsx для dev-запуска
- esbuild + Vite для production build
- WebSocket server на `/ws`
- Telegraf для Telegram-бота
- FFmpeg/FFprobe для видео и Stories

### Внешние системы

- Directus — основная база данных, пользователи, роли, CMS/API.
- PostgreSQL — база под Directus.
- N8N — workflow-оркестрация публикаций и сбора данных.
- Beget S3 — хранение изображений и видео.
- AI-провайдеры: Gemini/Vertex AI, DeepSeek, Claude, Qwen, FAL AI.
- Социальные платформы: Instagram, Facebook, VK, Telegram, YouTube, TikTok, Threads.

## 3. Запуск и сборка

Основные npm scripts:

- `npm run dev` — запускает сервер через `tsx server/index.ts`.
- `npm run build` — собирает фронтенд через Vite и backend bundle через esbuild.
- `npm start` — запускает production bundle `dist/server/index.js`.

Текущий проект успешно собирается командой `npm run build`.

Workflow `Start application` запускает приложение на порту 5000.

## 4. Главные директории

### `client/`

Фронтенд приложения.

Важные зоны:

- `client/src/App.tsx` — основная карта frontend routes.
- `client/src/pages/` — страницы приложения.
- `client/src/components/` — UI и бизнес-компоненты.
- `client/src/components/ui/` — базовые shadcn/Radix компоненты.
- `client/src/lib/queryClient.ts` — общий API-клиент, React Query, обработка 401 и refresh token.
- `client/src/lib/auth.ts` — login/logout/refresh token logic.
- `client/src/hooks/use-auth.tsx` — auth provider/state.
- `client/src/lib/store.ts`, `campaignStore.ts`, `storyStore.ts` — локальные состояния.
- `client/src/i18n.ts`, `client/src/locales/` — локализация.

### `server/`

Backend Express-приложение.

Важные зоны:

- `server/index.ts` — главный entrypoint сервера.
- `server/routes.ts` — модульная регистрация части маршрутов.
- `server/routes/` — доменные роуты.
- `server/api/` — API/webhook routes, часть исторически вынесена отдельно.
- `server/services/` — бизнес-логика и интеграции.
- `server/middleware/` — auth и вспомогательные middleware.
- `server/telegram-bot/` — Telegram bot.
- `server/utils/` — утилиты: логирование, N8N URL, media helpers, OAuth helpers.

### `shared/`

Общие типы и схемы. Важно: `shared/schema.ts` сейчас выглядит как compatibility layer и не описывает полную актуальную модель данных. Настоящая модель данных живёт в Directus.

### Документация

Полезные файлы:

- `replit.md` — актуальная сводка архитектуры и пользовательских предпочтений.
- `README.md` — базовое описание и старый quickstart.
- `TECHNICAL_SPECIFICATION.md` — подробное ТЗ/архитектура.
- `ТЕХНИЧЕСКАЯ_ДОКУМЕНТАЦИЯ_ФУНКЦИОНАЛ.md` — русская техническая документация по функционалу.
- Документы по публикациям, дубликатам, Stories, YouTube, Instagram, N8N — полезны при точечных доработках соответствующих зон.

Часть документации устарела или описывает целевое состояние, поэтому перед изменениями нужно сверяться с реальным кодом.

## 5. Frontend-архитектура

Основная маршрутизация находится в `client/src/App.tsx`.

Ключевые страницы:

- `/dashboard` — дашборд.
- `/campaigns` — список кампаний.
- `/campaigns/:id` — детали кампании.
- `/business-questionnaire/:id` — бизнес-анкета.
- `/keywords` — ключевые слова.
- `/content` — контент кампаний.
- `/edit-content/:contentId` — редактирование контента.
- `/posts` — посты.
- `/trends` — тренды.
- `/analytics` — аналитика.
- `/stories` и связанные routes — Stories editor.
- `/publish/scheduled` — запланированные публикации.
- `/publish/calendar` — календарь публикаций.
- `/ai-assistant` — AI Assistant.
- `/admin/*` — админские разделы.
- `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` — auth pages.
- `/pricing` — публичная страница тарифов.
- OAuth callback routes: YouTube, Instagram, TikTok, VK, Threads.

`AuthGuard` оборачивает приложение и пропускает публичные маршруты. Проверка истёкших токенов дополнительно выполняется в `App.tsx` каждую секунду.

## 6. Backend-архитектура

### `server/index.ts`

Это главный файл сервера. Он делает многое:

- Загружает env.
- Настраивает Express, CORS, cookie parser, body size limits.
- Создаёт HTTP server и WebSocket server.
- Регистрирует health endpoints.
- Регистрирует часть критичных API routes очень рано, чтобы они не перехватывались Vite/static middleware.
- Загружает API-ключи из Directus через `loadEnvFromDirectus()`.
- Настраивает FFmpeg/FFprobe.
- Регистрирует auth, analytics, trends, social publishing, global API keys, user API keys, OAuth routes, upload routes, Directus proxy, Telegram bot/webhook и многое другое.
- Инициализирует тяжёлые сервисы после старта сервера.

Важно: в `server/index.ts` много исторических и дублирующих регистраций. При добавлении новых маршрутов нужно проверять порядок регистрации.

### `server/routes.ts`

Функция `registerRoutes(app)` регистрирует модульные маршруты:

- tutorials
- reports
- webhooks
- validation
- publishing
- token routes
- content plan
- social
- ai
- campaigns
- content
- admin
- debug
- user

Некоторые маршруты закомментированы, потому что уже регистрируются напрямую в `server/index.ts`.

## 7. Ключевые backend routes

### Кампании — `server/routes/campaigns.ts`

Основные endpoints:

- `POST /api/campaigns`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `PATCH /api/campaigns/:id`
- `DELETE /api/campaigns/:campaignId`
- endpoints для keywords

Особенности:

- Данные идут в Directus collection `user_campaigns`.
- Есть проверка лимитов тарифов через `getPlanLimits()`.
- Есть soft ownership logic: некоторые проверки владельца ослаблены из-за миграционных fallback (`user_id` / `user_created`).
- Удаление кампании вручную чистит связанные коллекции: `campaign_content`, `campaign_content_sources`, `campaign_trend_topics`, `campaign_keywords`, `business_questionnaire`.

### Контент — `server/routes/content.ts`

Основные endpoints:

- `GET /api/campaign-content`
- `POST /api/campaign-content`
- `GET /api/campaign-content/:id`
- `PATCH /api/campaign-content/:id`
- `PUT /api/campaign-content/:id`
- `DELETE /api/campaign-content/:id`
- `POST /api/campaign-content/remove-duplicates`
- `POST /api/content/hashtags`

Особенности:

- Есть маппинг camelCase frontend fields в snake_case Directus fields.
- Основная Directus collection: `campaign_content`.
- Важные поля: `campaign_id`, `user_id`, `title`, `content`, `content_type`, `image_url`, `video_url`, `additional_images`, `additional_media`, `keywords`, `hashtags`, `links`, `scheduled_at`, `published_at`, `status`, `social_platforms`, `metadata`.

### AI — `server/routes/ai.ts`

Основные endpoints:

- `POST /api/generate`
- `POST /api/generate-content`
- `POST /api/generate-image`
- `POST /api/translate-to-english`
- `POST /api/generate-image-prompt`
- `POST /api/keywords/search`
- `POST /api/keywords/analyze-website`
- `GET /api/ai/validate-keys`
- `GET /api/proxy-image`

Особенности:

- Текстовая генерация идёт через `aiService.generateContent()`.
- Изображения могут идти через Gemini image или FAL AI.
- Есть fallback на Qwen для keyword search, если Gemini недоступен.
- API-ключи берутся через пользовательские или глобальные настройки.

### Аналитика/тренды — `server/routes/analytics.ts`

Основные endpoints:

- `POST /api/analytics/update`
- `GET /api/analytics/:campaignId`
- `GET /api/sources`
- `POST /api/sources`
- `GET /api/trends`
- `GET /api/campaign-trends`
- `GET /api/trends/sentiment/:campaignId`

Особенности:

- Обновление аналитики запускает N8N webhook fire-and-forget.
- Тренды читаются из `campaign_trend_topics`.
- Источники читаются из `campaign_content_sources`.
- Часть логики трендов вынесена в `server/api/trends-routes.ts`.

## 8. Работа с Directus

Directus — источник истины по данным, пользователям и ролям.

Ключевые файлы:

- `server/directus.ts` — Directus API manager на axios с token cache и refresh handling.
- `server/services/directus-crud.ts` — более унифицированный CRUD слой.
- `server/services/directus-auth-manager.ts` — управление Directus auth/session lifecycle.
- `server/services/directus-storage-adapter.ts` — storage adapter.
- `server/storage.ts` — старый/совместимый storage interface, большой файл с legacy-логикой.

Важно:

- В коде используются и `directusApi`, и `directusCrud`, и `storage`.
- Для системных операций часто используется admin/static token.
- Для пользовательских операций обычно используется JWT пользователя из `Authorization`.
- Перед изменением модели данных нужно проверять реальные поля коллекций Directus, а не полагаться только на `shared/schema.ts`.

## 9. Авторизация

Основной поток:

1. Frontend login вызывает `/api/auth/login`.
2. Backend логинится/проверяет пользователя через Directus.
3. Frontend сохраняет `auth_token`, `refresh_token`, `user_id` в localStorage.
4. `queryClient.ts` добавляет `Authorization: Bearer ...` и `x-user-id` к запросам.
5. При 401 frontend пытается выполнить refresh через `/api/auth/refresh`.
6. Backend middleware добавляет `req.user`.

Ключевые файлы:

- `client/src/lib/auth.ts`
- `client/src/lib/queryClient.ts`
- `client/src/hooks/use-auth.tsx`
- `client/src/components/AuthGuard.tsx`
- `server/api/auth-routes.ts`
- `server/middleware/auth.ts`
- `server/middleware/user-auth.ts`
- `server/services/directus-auth-manager.ts`

Риски:

- Логика auth распределена между несколькими файлами.
- Есть frontend interval, который проверяет токен каждую секунду.
- Есть Directus token refresh и Telegram session sync.
- Любые изменения в auth нужно делать очень точечно.

## 10. Публикации и планировщик

Ключевой файл: `server/services/publish-scheduler.ts`.

Планировщик:

- Работает каждые 30 секунд.
- Ищет `campaign_content` со статусами `scheduled`, `partial`, `pending`.
- Проверяет `social_platforms`.
- Определяет платформы, готовые к публикации.
- Использует lock/tracking/cache для защиты от дублей.
- Для большинства платформ запускает N8N webhooks.
- N8N считается источником истины по результату публикации и должен обновлять `social_platforms` в Directus.

Важные файлы:

- `server/services/publish-scheduler.ts`
- `server/services/publication-lock-manager.ts`
- `server/services/publication-tracking.ts`
- `server/services/status-checker.ts`
- `server/api/publishing-routes.ts`
- `server/api/social-publishing-router.ts`
- `server/utils/n8n-utils.ts`

Важная архитектурная договорённость:

- Сервер не должен преждевременно писать финальные результаты в `social_platforms` для платформ, которые обрабатывает N8N.
- N8N пишет результат публикации обратно в Directus.
- Исключения: отдельные прямые серверные сервисы, например VK Stories/Threads в части сценариев.

## 11. AI-интеграции

Ключевые файлы:

- `server/services/ai-service.ts`
- `server/services/gemini.ts`
- `server/services/gemini-vertex.ts`
- `server/services/gemini-vertex-direct.ts`
- `server/services/gemini-image.ts`
- `server/services/deepseek.ts`
- `server/services/claude.ts`
- `server/services/qwen.ts`
- `server/services/fal-ai-universal.ts`
- `server/services/global-api-keys.ts`
- `server/services/api-keys.ts`

Поддерживаемые сценарии:

- Генерация текста.
- Улучшение текста.
- Генерация prompt для изображений.
- Генерация изображений.
- Анализ сайта и ключевых слов.
- AI Assistant.
- Sentiment/trends/analytics в отдельных частях.

API-ключи могут быть:

- глобальными;
- пользовательскими;
- загруженными из Directus в env при старте.

## 12. Telegram

Ключевые зоны:

- `server/telegram-bot/`
- `server/services/telegram-session-storage.ts`
- Telegram webhook routes в `server/api/`
- Telegram WebApp/Mini App frontend routes и hooks.

Telegram-бот:

- Запускается после старта сервера.
- Работает в webhook mode.
- Сессии сохраняются в Directus.
- Поддерживает AI assistant, кампании, генерацию, голосовые сообщения, навигацию.

## 13. Stories и медиа

Ключевые зоны:

- `client/src/pages/stories/`
- `client/src/components/stories/`
- `server/routes/stories.ts`
- `server/services/stories-media-service.ts`
- `server/services/stories-image-generator.ts`
- `shared/stories-schema.ts`
- `shared/stories-constants.ts`

Медиа:

- Beget S3 используется для хранения изображений/видео.
- FFmpeg/FFprobe используется для видеообработки.
- Есть media proxy для Instagram Stories и конвертации изображений в 9:16.

## 14. Админка и тарифы

Админские страницы:

- `client/src/pages/admin/global-api-keys.tsx`
- `client/src/pages/admin/UserManagement.tsx`
- `client/src/pages/admin/telegram-channels.tsx`
- `client/src/pages/admin/promo-codes.tsx`

Backend:

- `server/routes/admin.ts`
- `server/routes/admin-users.ts`
- `server/routes-global-api-keys.ts`
- `server/routes/promo-codes.ts`
- `server/routes/subscriptions.ts`
- `server/routes/yookassa.ts`

Есть тарифная логика через:

- `server/services/plan-limits.ts`
- pricing page `/pricing`
- subscription-related components and guards.

## 15. Важные риски и особенности кодовой базы

1. Проект большой и исторически развивался слоями.
2. Есть дублирующие маршруты и ранняя регистрация routes в `server/index.ts`.
3. Часть документации устарела или расходится с текущим кодом.
4. Directus schema важнее `shared/schema.ts`.
5. Auth/token refresh распределены между фронтендом, backend middleware и Directus services.
6. Публикации зависят от N8N, поэтому баги публикации часто находятся вне одного файла приложения.
7. `social_platforms` — критичное JSON-поле для статусов публикаций.
8. Для доработок лучше не делать широкие рефакторинги без необходимости.
9. В проекте много тестовых/диагностических файлов и исторических скриптов в корне.
10. Секреты/токены встречаются в документации и env-related файлах; их нельзя выводить или переносить без необходимости.

## 16. Где безопаснее дорабатывать функционал

### UI доработки

Начинать с:

- `client/src/pages/...`
- `client/src/components/...`
- `client/src/lib/queryClient.ts` только если меняется API-поведение.

### Новая backend API логика

Лучше добавлять в:

- `server/routes/<domain>.ts`

и регистрировать через:

- `server/routes.ts`

Но если endpoint критичен и может перехватываться Vite/static middleware, нужно учитывать паттерн ранней регистрации в `server/index.ts`.

### Работа с Directus

Предпочтительно использовать:

- `server/services/directus-crud.ts`

Для пользовательских операций передавать user auth token, для системных — `useAdminToken: true`, если это действительно системная операция.

### Публикации

Перед изменениями изучать:

- `server/services/publish-scheduler.ts`
- `server/api/publishing-routes.ts`
- `server/api/social-publishing-router.ts`
- `server/utils/n8n-utils.ts`
- соответствующие N8N webhook expectations

### AI

Перед изменениями изучать:

- `server/services/ai-service.ts`
- конкретный provider service
- `server/routes/ai.ts`

### Stories

Перед изменениями изучать:

- frontend story editor components
- `server/routes/stories.ts`
- `shared/stories-schema.ts`
- media upload/proxy services

## 17. Рекомендуемый порядок работы над будущими задачами

1. Сначала определить функциональную область: campaigns/content/publishing/analytics/stories/auth/admin/AI.
2. Найти frontend entrypoint: page/component.
3. Найти API endpoint, который вызывается из frontend.
4. Найти backend route и service.
5. Проверить, какие Directus collections/fields реально используются.
6. Если затронута публикация — проверить `social_platforms`, scheduler и N8N webhook contract.
7. Внести минимальное точечное изменение.
8. Запустить/перезапустить проект.
9. Проверить runtime logs, а не только статическую типизацию.
10. Для frontend changes, особенно связанных с Telegram compatibility, делать `npm run build`.

## 18. Быстрая карта: файл → назначение

| Файл/директория | Назначение |
|---|---|
| `client/src/App.tsx` | Frontend routing |
| `client/src/pages/campaigns/` | Кампании |
| `client/src/pages/content/` | Контент |
| `client/src/pages/analytics/` | Аналитика |
| `client/src/pages/trends/` | Тренды |
| `client/src/pages/stories/` | Stories |
| `client/src/pages/publish/` | Публикации/календарь |
| `client/src/components/Layout.tsx` | Основная оболочка приложения |
| `client/src/components/AuthGuard.tsx` | Защита маршрутов |
| `client/src/lib/queryClient.ts` | API client + React Query |
| `client/src/lib/auth.ts` | Frontend auth helpers |
| `server/index.ts` | Главный backend entrypoint |
| `server/routes.ts` | Модульная регистрация routes |
| `server/routes/campaigns.ts` | Campaigns + keywords |
| `server/routes/content.ts` | Campaign content CRUD |
| `server/routes/ai.ts` | AI endpoints |
| `server/routes/analytics.ts` | Analytics/trends/sources |
| `server/services/directus-crud.ts` | Унифицированный Directus CRUD |
| `server/directus.ts` | Directus API manager |
| `server/services/publish-scheduler.ts` | Планировщик публикаций |
| `server/utils/n8n-utils.ts` | N8N URL/helpers |
| `server/telegram-bot/` | Telegram bot |
| `shared/schema.ts` | Compatibility types, не полная DB schema |
| `shared/stories-schema.ts` | Stories schema |

## 19. Практический вывод

Проект готов к доработкам, но менять его нужно точечно. Самые рискованные зоны: auth, scheduler/publishing, Directus schema, N8N contract, Telegram sessions. Самые безопасные зоны для первых улучшений: UI-страницы, отдельные компоненты, новые endpoints без изменения существующей публикационной цепочки.
