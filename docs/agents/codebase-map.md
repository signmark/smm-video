# Карта кодовой базы smm-video

**Для кого:** Hermes / Mavis / Mimo — быстрая ориентация «где что лежит и как течёт запрос», без чтения 1276 строк index.ts.
**Снимок:** 2026-07-24. При расхождении с кодом — код прав, обнови этот файл (зона Mavis).
**Связка:** уроки-грабли лежат в `.agents/memory/` — эта карта говорит «где», уроки говорят «почему больно».

---

## Общая топология

```
client/  (React 18 + TanStack Query + Vite)
   │ HTTP /api/*
server/  (Express, ESM, TypeScript)
   │ REST + admin token
Directus (CMS + PostgreSQL: users, campaigns, campaign_content, настройки соцсетей)
   │
Внешние API: Telegram / VK / Instagram Graph / Facebook / YouTube / TikTok / Threads,
             FAL AI, Gemini (только через прокси!), Vertex, скрейперы
```

Directus — не «админка сбоку», а **основная БД**. Прямого Postgres-доступа код почти не имеет; всё через Directus REST. Отсюда главный класс багов: schema drift (см. урок `directus-schema-drift.md`).

## Серверный вход: `server/index.ts` (~1276 строк, порядок = закон)

Порядок регистрации middleware **семантически значим** — многие баги были именно про порядок:

1. Ранние `app.use('/api', express.json({limit:'1mb'}))` + oauth-bypass маршруты (вебхуки токенов должны работать ДО глобального auth).
2. `helmet` (CSP), `cors`, `express.json({limit:'50mb'})`, `cookieParser`.
3. Rate limiters: `sensitiveLimiter` на login/register/password-reset/payments, `globalApiLimiter` на весь /api.
4. **Глобальный гейт `requireActiveSubscription`** (`server/middleware/require-active-subscription.ts`): GET свободны, мутации истёкших юзеров → 403. Личность — через /users/me с user-токеном (см. урок `subscription-enforcement.md`).
5. Пачка `app.use('/api', ...)` роутеров (feature flags, clips, social publishing, facebook, youtube...).
6. `registerRoutes(app)` из `server/routes.ts` — регистрирует вебхуки платформ и register*-функции фичевых роутов.
7. Статика: `/landing`, `/alisa`, `/video-app`, потом vite/SPA-фолбэк.

**Следствие:** удалённый или переставленный роут может начать отдавать 401 вместо 404 — запрос перехватывает более ранний глобальный auth-мидлварь (урок в `.agents/memory/MEMORY.md`). Прежде чем сказать «роута нет», проверь, кто выше по цепочке.

## Слои маршрутов (три, исторически)

| Слой | Где | Что там |
|---|---|---|
| `server/api/*` | вебхуки и publishing-роутеры | `*-webhook-direct.ts` per-platform, `facebook-webhook-unified.ts`, `social-publishing-router.ts`, `publishing-routes.ts`, `auth-routes.ts`, `validation-routes.ts`, `token-routes.ts` |
| `server/routes/*` | фичевые REST-роуты | `campaigns.ts`, `content.ts`, `campaign-<platform>-settings.ts` (fb/ig/vk/threads/youtube), `<platform>-oauth.ts`, `social.ts`, `admin*.ts`, `health.ts`, `yookassa.ts` (платежи) |
| `server/routes-*.ts` (корень) | AI-провайдеры | `routes-gemini.ts`, `routes-deepseek.ts`, `routes-fal-ai-images.ts`, `routes-qwen.ts`, `routes-claude.ts`, ключи: `routes-global-api-keys.ts` / `routes-user-api-keys.ts` |

Дубликаты случаются (два одинаковых роута в одном файле — Express молча берёт первый). При странном поведении роута — `grep` путь по всему server/, а не только по «очевидному» файлу.

## Сервисы: где бизнес-логика

- **`services/publish-scheduler.ts` — главный путь публикации.** `setInterval`-цикл, забирает контент по расписанию из Directus, ведёт per-платформенные статусы. n8n удалён полностью — если видишь упоминание n8n, это мёртвый код/док (урок `n8n-removal.md`).
- **`services/social-platforms/*-service.ts`** — per-platform реализации (`base-service.ts` — общий контракт; telegram, vk+clips+stories, instagram+reels+stories, facebook, youtube+shorts+video, tiktok, threads).
- **`services/oauth-response-sanitizer.ts`** — вырезает секреты из всех API-ответов. **Контракт священен**, дважды ломали: см. урок `oauth-sanitizer-contract.md` и handoff `docs/prompts/hermes-social-ui-token-removal-2026-07-24.md`.
- **`services/directus-*`** — auth-manager, crud, session-policy/validator, storage-adapter. `services/admin-token-manager.ts` — админ-токен ТОЛЬКО для серверных задач (урок `user-token-policy.md`).
- **`services/status-checker.ts` / `status-validator.ts` / `publication-tracking.ts`** — сверка «опубликовалось ли на самом деле».
- **`services/publication-lock-manager.ts`** — защита от двойной публикации при нескольких инстансах (см. `docs/MULTI_SERVER_PROTECTION.md`, spec-12 durable claim).
- Аналитика: `analytics-service.ts`, `analytics-aggregation.ts`, `scraper-analytics.ts` + внешние скрейперы (уроки `scraper-api-config.md`, `comment-collector-scraper.md`).
- Тренды: `trend-collector.ts`, `daily-trend-scheduler.ts`, `crawler.ts`.
- Видео-конвейер: отдельное приложение `video-app/` + `services/real-video-converter.ts`; уроки `video-stock-gate.md`, `video-music-sync.md`, `video-prompt-engineering.md`, `heygen-avatar-integration.md`.

## Auth (упрощённо)

1. Логин → Directus выдаёт user-токен → фронт держит его, шлёт в Authorization.
2. `server/middleware/user-auth.ts` (`authenticateUser`, экспортируется как `authMiddleware`) валидирует.
3. Просроченный токен → 401 c `sessionExpired` — фронт разлогинивает.
4. Admin-токен (`admin-token-manager.ts`) — только серверные фоновые задачи, никогда не для UI-операций от имени юзера.
5. Публичный `/api/auth/system-token` удалён (§1 security-плана, коммит `1473f4bf`) — не возвращать.

## Фронтенд: `client/src/`

- `pages/` — по фичам: campaigns, content, publish, analytics, video, stories, trends, posts, auth, admin, payment + `<platform>-callback.tsx` (OAuth-редиректы).
- `components/` — крупные формы настроек: `SocialMediaSettings.tsx`, `FacebookSetupWizard.tsx`, `InstagramSetupWizardSimple.tsx` — именно тут живёт контракт «фронт не читает токены» (урок `oauth-sanitizer-contract.md`).
- Данные — TanStack Query; статус «настроено» вычисляется по несекретным полям (channelId/pageId/groupId/chatId/...), НЕ по наличию токена.
- Билд: `NODE_OPTIONS=--max-old-space-size=1024 npx vite build` — без флага падает молча с exit -1 (урок `vite-build-memory.md`).

## Как течёт публикация (главный бизнес-цикл)

1. Юзер создаёт контент (страницы content/publish) → запись в Directus `campaign_content` со scheduled-временем и списком платформ.
2. `publish-scheduler.ts` по интервалу выбирает созревшие записи, берёт lock (`publication-lock-manager`), зовёт нужный `social-platforms/*-service`.
3. Сервис достаёт токены кампании из Directus (серверно!), публикует, пишет per-platform статус обратно.
4. `status-checker` досверяет фактический статус; аналитика подтягивается скрейперами/API позже.
5. Ошибка платформы = статус error по этой платформе, остальные не блокируются.

## Тесты и гейты

- `npx vitest run` — ~717 тестов / 69 файлов, конфиги `vitest.config.ts` (+ `vitest.integration.config.ts`). Тесты в `server/__tests__/` — читай соседние тесты подсистемы перед правкой, это самая честная документация.
- `npx tsc -p tsconfig.critical.json` — обязательный гейт (полный tsc пока красный — spec-09).
- Playwright-смоки: `playwright.config.ts`, прогон на живом стенде после merge.
- Сетевые вызовы в тестах мокаются (см. `docs/prompts/codex-mock-network-in-tests.md`) — тест, который ходит в реальный API, будет флаковать и это блокер на ревью.

## Диагностика: порядок раскопок (метод, не интуиция)

1. **Воспроизведи** через curl/тест, зафиксируй вход→неверный выход. Без воспроизведения не чинить.
2. **Найди все точки входа**: `grep -rn "<путь-роута>" server/` — из-за трёх слоёв роутов и дубликатов «очевидный» файл часто не тот.
3. **Проверь порядок middleware** (index.ts) — 401/403/404-аномалии почти всегда про порядок или глобальные гейты.
4. **Сверь схему Directus** через GET /fields, если «значение сохраняется, но пропадает» — это schema drift, а не твой код.
5. **Открой урок подсистемы** в `.agents/memory/` — вероятно, туда уже наступали.
6. Prod-диагностика (Hermes, read-only): `docker ps`, логи контейнера `smm`, `docker exec smm grep -c "<паттерн>" /app/dist/server/index.mjs` — проверить, что фикс вообще в бандле (частый ложный след: «не работает» = «не задеплоено»).

## Что где почитать глубже

- Security-бэклог и порядок работ: `docs/followups/2026-07-24-security-backlog.md` + спеки `docs/specs/` (§6-§15, порядок в README).
- Архитектура API: `docs/api/API_ARCHITECTURE_GUIDE.md`; политика ключей: `docs/api/API_KEYS_STORAGE_POLICY.md`.
- Паблишер: `docs/technical/PUBLISHER_*` серия.
- Аналитика: `docs/technical/ANALYTICS_*`.
- Мульти-сервер: `docs/MULTI_SERVER_PROTECTION.md`.
- История решений: `docs/captains-log/`, вердикты и handoff'ы: `docs/prompts/`.
