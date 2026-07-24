# Анализ кодовой базы `smm-video`

Дата анализа: 2026-07-23  
Объект: `G:\Projects\smm-video`  
Метод: изучен `project_snapshot.txt`, затем точечно проверены реальные файлы приложения, конфигурация сборки, auth, middleware, публикация, фоновые задачи и клиентское хранение токенов. Выполнены `npm run check`, `npm run check:production`, `npm run build` и три набора auth-тестов. Значения рабочего `.env` не читались.

## Краткий вывод

Проект — крупный TypeScript-монолит: React/Vite SPA и Express API в одном репозитории и одном production bundle, Directus используется как основное внешнее хранилище/API, а публикация и сбор данных выполняются фоновыми таймерами внутри HTTP-процесса.

Текущее состояние нельзя считать production-safe по трём подтверждённым причинам:

1. Публичный endpoint возвращает административный Directus-токен без аутентификации (`server/api/auth-routes.ts:784-806`).
2. В отслеживаемом Git файле `.env.example` находятся похожие на реальные секреты, а не placeholders (`.env.example:27-29,67-68,74-75,140-141`).
3. Production type-check не проходит: 399 ошибок в 80 файлах. Обычный `npm run check` проверяет только семь вручную выбранных файлов, а build не запускает TypeScript-проверку.

Эти пункты требуют реакции до рефакторинга и оптимизации.

## 1. Архитектура и стек

### Клиент

- React 18 + TypeScript, сборка Vite (`package.json`, `vite.config.ts`).
- Маршрутизация: Wouter.
- Server state: TanStack React Query; локальное состояние также ведётся через Zustand.
- UI: Tailwind CSS, Radix UI, Framer Motion, TipTap, Nivo/Recharts.
- SPA собирается в `dist/public`; основные production chunks после текущей сборки:
  - `dist/public/assets/index-DJ6Dlmcp.js` — 762,555 байт;
  - `dist/public/assets/RichTextEditor-0VzpvMSv.js` — 675,314 байт;
  - `dist/public/assets/index-2Tkco7QJ.js` — 394,063 байт.
- Vite сообщает, что смешанные static/dynamic imports для `queryClient.ts`, `auth.ts` и `refreshAuth.ts` не дают вынести их в отдельные chunks.

### Сервер

- Node.js 20+ / Express 4 / TypeScript.
- Один entrypoint `server/index.ts` размером 54,719 байт регистрирует HTTP routes, WebSocket, middleware, статику, Telegram bot и фоновые таймеры.
- Production server собирается esbuild в единый `dist/server/index.js` размером 3,599,968 байт (`package.json:14`).
- API разделён между `server/api`, `server/routes` и отдельными файлами `server/routes-*.ts`; единой границы модулей нет.
- Основное хранилище и identity provider — внешний Directus. Доступ реализован несколькими слоями: `directus.ts`, `directus-auth-manager.ts`, `directus-crud.ts`, `directus-proxy.ts`.
- В зависимостях есть Drizzle ORM, PostgreSQL/Neon, но значительная часть бизнес-кода обращается к Directus HTTP API.
- Объектное хранение: S3-совместимое Beget S3, AWS SDK, Google Cloud Storage.
- Медиа: FFmpeg/ffprobe, Sharp, Chromium; Docker image устанавливает эти системные пакеты.
- Интеграции: Telegram, VK, Instagram/Facebook, YouTube, TikTok, Threads; AI-провайдеры Google Gemini, Anthropic, OpenAI, DeepSeek/Qwen и FAL.
- В репозитории есть отдельный `video-app`, а также устаревшие n8n workflows и большой `_archive`; основной сервер при этом уже содержит собственный publish scheduler.

### Фоновые процессы

Фоновые операции не вынесены в отдельный worker/queue. Они запускаются в HTTP-процессе через `setInterval`/`setTimeout`:

- publish scheduler — `server/services/publish-scheduler.ts:163-178`, старт из `server/index.ts:1061-1066`;
- автономные AI-задачи — несколько таймеров в `server/services/autonomous-ai.ts`;
- trend collection, token refresh, status validation, cache cleanup и Telegram bot — также из того же процесса.

Это архитектура одного экземпляра процесса. Горизонтальное масштабирование создаёт несколько независимых schedulers и in-memory locks.

### Тестирование и сборка

- Найдено 109 test/spec файлов: 72 server, 11 client, 26 в корневом `tests`.
- Используются Vitest, Jest и Playwright одновременно.
- Точечный запуск auth-тестов успешен: 3 файла, 14 тестов.
- `npm run build` успешен, но build не содержит `tsc` (`package.json:14`).
- `npm run check` успешен только потому, что `tsconfig.critical.json:3-12` перечисляет семь файлов.
- `npm run check:production` завершается с 399 TypeScript-ошибками в 80 файлах.

## 2. Конкретные узкие места и дефекты

### Критические

#### 2.1. Публичная выдача административного токена

`server/api/auth-routes.ts:784-806` регистрирует:

```ts
app.get('/api/auth/system-token', async (req, res) => {
  // ...
  return res.status(200).json({ success: true, token: adminToken });
});
```

На маршруте нет `authenticateUser`, проверки admin role или внутреннего service credential. Если токен уже есть в cache, возвращается cached token; иначе вызывается `directusApiManager.getAdminToken()`. Маршрут зарегистрирован рано через `registerAuthRoutes(app)` (`server/index.ts:243-246`) и находится под разрешённым `/api/auth` prefix subscription gate (`server/middleware/require-active-subscription.ts:35-40`).

Последствие: внешний клиент может получить административный Directus-токен и обращаться к Directus с полномочиями сервиса. Это полный обход прикладной авторизации.

Исправление: немедленно удалить endpoint из публичного router. Если он действительно нужен сервису, заменить на серверный вызов без HTTP либо выделить отдельный internal-only listener с mTLS/service authentication и никогда не возвращать upstream admin token клиенту.

#### 2.2. Секреты, похожие на реальные, закоммичены в `.env.example`

Файл отслеживается Git, потому что `.gitignore` явно исключает `.env.example` и `.env.sample` из общего правила `.env.*`.

Следующие значения непустые, не содержат marker-ов `your/change/replace/example/placeholder` и имеют длины, характерные для реальных credentials:

- Directus tokens: `.env.example:27-29`;
- S3 access/secret keys: `.env.example:67-68`;
- Gemini/Vertex keys: `.env.example:74-75`;
- YooKassa secret/shop ID: `.env.example:140-141`.

Значения в отчёте намеренно не приводятся.

Последствие: компрометация Directus, S3, AI billing и платежной интеграции возможна через историю Git, даже если текущий файл исправить.

Исправление: считать все эти credentials скомпрометированными, отозвать/перевыпустить у провайдеров, проверить audit logs и S3 access logs, затем заменить значения в шаблоне на placeholders. После ротации очистить историю репозитория с согласованной процедурой, учитывая forks/clones.

#### 2.3. Любой аутентифицированный пользователь управляет глобальным scheduler

`server/api/publishing-routes.ts:304-316` использует только `authenticateUser`, после чего любой пользователь может вызвать `/api/publish/toggle-publishing?enable=false` и остановить общий singleton scheduler для всех tenants. Метод зарегистрирован через `app.all`, поэтому изменение состояния возможно даже GET-запросом.

Аналогично `/api/publish/reset-processed-cache` на `server/api/publishing-routes.ts:403-411` останавливает и запускает общий scheduler без admin authorization.

Последствие: межтенантный denial of service и изменение глобального состояния пользователем без admin role.

Исправление: убрать эти операции из пользовательского API или потребовать строгий `requireAdmin`; разрешить только POST; отделить per-user операции от process-global controls.

### Высокий приоритет

#### 2.4. WebSocket не аутентифицирован и рассылает данные всем клиентам

- Upgrade на `/ws` принимается без проверки cookie/token/origin: `server/index.ts:121-149`.
- `setNotificationBroadcaster` отправляет каждое событие всем `wss.clients`: `server/index.ts:153-161`.
- Publish scheduler отправляет события с `contentId` и platform, например `server/services/publish-scheduler.ts:999,1104,1148,1338,1363,1388`.

В соединении нет tenant/user binding, подписок или фильтрации.

Последствие: утечка метаданных и событий публикации между пользователями; неаутентифицированный клиент может наблюдать внутреннюю активность.

Исправление: валидировать Directus session во время upgrade, привязать socket к user ID, отправлять notification только владельцу/разрешённой группе, ограничить Origin и размер/частоту входящих сообщений.

#### 2.5. Загрузка файла в память без лимита и проверки типа

- Глобальный JSON/urlencoded limit установлен в 50 MB: `server/index.ts:184-185`.
- Multer использует `memoryStorage()` без `limits` и `fileFilter`: `server/index.ts:342`.
- `/api/s3/upload-image` принимает любой MIME/name и весь buffer держит в heap: `server/index.ts:344-362`.
- Клиентский `originalname` включается в S3 key без нормализации: `server/index.ts:356`.
- В ошибке клиенту возвращается внутренний `error.message`: `server/index.ts:378-380`.

Последствие: несколько параллельных загрузок способны исчерпать heap; endpoint «image» принимает произвольный контент; неочищенное имя создаёт неконтролируемые S3 keys; внутренние ошибки раскрываются клиенту.

Исправление: streaming upload или disk/temp spool, жёсткий лимит размера, allowlist MIME + проверка magic bytes, server-generated key/extension, generic 5xx response.

#### 2.6. Access и refresh tokens постоянно хранятся в `localStorage`

`client/src/lib/auth.ts:120-130` сохраняет `auth_token` и `refresh_token` в `localStorage`. Эти значения читаются десятками компонентов напрямую. Одновременно CSP полностью отключён (`server/index.ts:107-115`).

Последствие: любой XSS получает долговременный refresh token. Поверхность XSS велика из-за rich-text editor, AI-generated content и многочисленных внешних интеграций.

Исправление: refresh token перенести в `HttpOnly`, `Secure`, `SameSite` cookie; access token держать в памяти с коротким TTL; вернуть строгую CSP с точечными `frame-ancestors`/`connect-src` для Telegram и S3 вместо полного отключения CSP и frameguard.

#### 2.7. Subscription enforcement fail-open

`server/middleware/require-active-subscription.ts:117-133` при любой ошибке Directus вызывает `next()`. В комментарии это заявлено как намеренное поведение (`:21-24`). Кроме того, mutating request без токена также пропускается (`:104-106`) в расчёте на route-level auth.

Последствие: при деградации Directus истёкшие/неоплатившие пользователи могут запускать платные AI, media и publication операции. Любой случайно добавленный route без собственного auth автоматически обходит и subscription gate.

Исправление: fail-closed для операций с прямой стоимостью и публикацией; публичные/webhook routes определить явным allowlist, а не правилом «нет токена — пропустить»; кэшировать последний подтверждённый entitlement по user ID, не по полному bearer token.

#### 2.8. Production type safety фактически отключена

- `package.json:14`: build выполняет только Vite + esbuild.
- `tsconfig.critical.json:3-12`: default `npm run check` охватывает семь файлов.
- Полная production проверка дала 399 ошибок в 80 файлах.

Среди ошибок есть не только стилистика:

- `server/services/gemini-proxy.ts:246-247` — использование несуществующей переменной `url`;
- `server/services/qwen.ts:51` — declaration без корректной реализации;
- `server/services/social/base-service.ts:29` — несуществующие `email` и `password`;
- `server/services/social-platforms/telegram-service.ts:221,285,289-290` — `messageId` используется до присваивания;
- `server/telegram-bot/index.ts:1815` — вызов отсутствующего метода;
- `client/src/components/InstagramSetupWizard.tsx:78,90,202+` — отсутствуют state/setter/steps;
- `client/src/components/MediaUploader.tsx:53-55` — отсутствующие модули/экспорт.

Сборка остаётся зелёной, потому что esbuild транспилирует без type-check.

Исправление: сделать полный `tsc --noEmit` обязательным до build/deploy; временно можно разделить frontend/backend configs, но нельзя скрывать ошибки ручным списком файлов.

### Надёжность и производительность

#### 2.9. In-process scheduler и locks не защищают от нескольких replicas

- Singleton scheduler локален процессу: `server/services/publish-scheduler.ts:76-91,1897`.
- Защита `isProcessing` и `processedContentCache` — только в памяти одного процесса.
- Publication locks — in-memory Maps: `server/services/publication-lock-manager.ts:9-11`.
- Scheduler автоматически стартует в каждом процессе: `server/index.ts:1061-1066`.

Последствие: при двух replicas обе будут выбирать scheduled content и пытаться публиковать его. In-memory cache/lock не предотвращает двойную внешнюю публикацию; рестарт полностью стирает защитное состояние.

Исправление: вынести jobs в очередь/worker; использовать атомарный DB claim (`UPDATE ... WHERE status='scheduled' ... RETURNING`) или distributed lock с lease; добавить idempotency key на `(content_id, platform, scheduled_version)`.

#### 2.10. HTTP-процесс перегружен несвязанными обязанностями

`server/index.ts` одновременно обслуживает SPA/API/WebSocket, запускает Telegram bot, publish scheduler, autonomous restore, status validator и множество cleanup/token timers (`server/index.ts:1028-1079,1124,1169,1182`).

Последствие: CPU/RAM spike от AI/media/bot задач ухудшает HTTP latency; падение одного процесса останавливает все функции; graceful shutdown и readiness сложно сделать корректно.

Исправление: минимум три process role: web API, durable worker, bot; readiness должен проверять критические зависимости, а не только возвращать uptime.

#### 2.11. Health endpoint не проверяет зависимости

`server/index.ts:229-235` всегда отвечает `healthy`, сообщая только timestamp, uptime, environment и version.

Последствие: orchestrator оставляет instance в rotation при недоступном Directus/S3/queue, хотя основные операции не работают.

Исправление: разделить `/live` и `/ready`; readiness с короткими timeout проверяет Directus и обязательное хранилище, не раскрывая чувствительные детали.

#### 2.12. Крупные модули и bundle увеличивают стоимость изменений

Крупнейшие файлы:

- `server/services/autonomous-ai.ts` — 224,136 байт;
- `client/src/pages/content/index.tsx` — 221,044;
- `client/src/pages/trends/index.tsx` — 188,438;
- `server/telegram-bot/index.ts` — 141,441;
- `server/api/social-publishing-router.ts` — 133,024;
- `server/services/social-publishing.ts` — 122,393;
- `server/api/trends-routes.ts` — 119,029;
- `client/src/components/SocialMediaSettings.tsx` — 115,640;
- `server/services/publish-scheduler.ts` — 100,457.

Это не только вопрос читаемости: маршруты, валидация, orchestration, provider-specific logic и persistence смешаны, поэтому auth/tenant проверки легко пропустить. На клиенте результат виден в chunks 762 KB и 675 KB и предупреждении Vite о chunks >500 KB.

Исправление: делить по use case/provider, lazy-load тяжёлые pages/editors, убрать смешанные static/dynamic imports общих auth/query модулей.

#### 2.13. Установка зависимостей в Docker недетерминирована

`Dockerfile:23,61-62` использует `npm install`, а не `npm ci`; во втором stage выполняется дополнительный `npm install` двух пакетов поверх production install.

Последствие: один commit может давать разные dependency trees; лишние install-слои замедляют build и усложняют SBOM/воспроизводимость.

Исправление: `npm ci` в обоих stages, один lockfile-driven install, BuildKit cache; не переустанавливать уже перечисленные production dependencies.

#### 2.14. Логи избыточны и содержат идентификаторы

- Каждый HTTP request логируется через `console.log`: `server/index.ts:170-172`.
- Auth middleware логирует Directus URL, user ID и admin status: `server/middleware/user-auth.ts:18-45`.
- В коде много прямых `console.log/error` и пустых `catch`; особенно в scheduler публикации.

Последствие: высокий объём логов, PII/tenant metadata в output, слабая диагностируемость из-за проглоченных ошибок.

Исправление: structured logger, request ID, redaction, уровни; запрет прямого console в server code; ошибки публикации должны записываться с content/platform/attempt и переходом состояния, а не подавляться.

## 3. Риски

### Безопасность

| Риск | Вероятность | Ущерб | Основание |
|---|---:|---:|---|
| Захват Directus через публичный admin token | высокая | критический | `auth-routes.ts:784-806` |
| Использование закоммиченных provider credentials | высокая, пока не доказана ротация | критический | `.env.example:27-29,67-68,74-75,140-141` |
| Межтенантная остановка публикаций | высокая | высокий | `publishing-routes.ts:304-316` |
| Межтенантная утечка notifications | высокая | высокий | `index.ts:121-161` |
| Кража refresh token при XSS | средняя | высокий | `auth.ts:120-130`, CSP off |
| Memory DoS через upload | средняя/высокая | высокий | `index.ts:342-362` |
| Обход подписки при Directus outage | средняя | финансовый/операционный | `require-active-subscription.ts:117-133` |

### Надёжность

- Двойная публикация при нескольких replicas или race после рестарта.
- Скрытые runtime-дефекты из 399 TypeScript-ошибок.
- HTTP, bot и scheduler имеют общий blast radius.
- `/health` даёт ложноположительный healthy status.
- In-memory OAuth/session/job Maps теряются при рестарте; некоторые flows нельзя безопасно распределить между replicas.
- Пустые `catch` в publish paths могут оставить content в неверном статусе без retry/audit trail.

### Производительность

- До 50 MB parsing на запрос и unbounded Multer memory buffer.
- Два клиентских JS chunks >600 KB; Vite не может выполнить ожидаемое code splitting из-за смешанных imports.
- 3.6 MB server bundle замедляет cold start и затрудняет анализ dependency boundaries.
- Несколько polling timers делают повторные запросы к Directus из каждого process replica.
- Огромные React pages и service modules затрудняют memoization/code splitting и увеличивают риск широких rerenders/регрессий.

## 4. Что доработать в первую очередь

### P0 — сегодня, как security incident

1. Удалить `/api/auth/system-token`; задеплоить hotfix.
2. Отозвать и перевыпустить все непустые credentials из `.env.example`; проверить provider audit logs и расходы.
3. Заменить значения шаблона placeholders и согласованно очистить Git history после ротации.
4. Ограничить global scheduler controls admin-only POST либо полностью убрать из публичного API.
5. Временно закрыть `/ws` или добавить обязательную session validation и user-scoped broadcast.
6. Добавить upload limit/MIME validation до следующего публичного релиза.

### P1 — ближайшие 2-5 дней

1. Включить полный type-check как обязательный CI/deploy gate; исправлять сначала runtime-significant ошибки (`url`, `messageId`, missing methods/modules), затем оставшиеся.
2. Добавить security regression tests:
   - anonymous request к system-token всегда 404;
   - non-admin не может управлять scheduler;
   - WebSocket A не получает events пользователя B;
   - oversized/non-image upload получает 413/415;
   - Directus outage не открывает платные mutating endpoints.
3. Перенести refresh token в HttpOnly cookie и вернуть CSP.
4. Ввести `/live` и `/ready`, structured/redacted logging.

### P2 — 1-3 недели

1. Вынести scheduler в отдельный worker и реализовать durable atomic claiming/idempotency.
2. Разделить `server/index.ts`, `publish-scheduler.ts`, `autonomous-ai.ts`, social publishing router/service по use cases и providers.
3. Свести auth/session/directus access к одному проверяемому adapter; перестать принимать `x-user-id` как источник identity, использовать только identity из валидированной сессии.
4. Разбить тяжёлые React pages на lazy routes/features; устранить mixed imports; поставить bundle budgets.
5. Перевести Docker на `npm ci`, добавить dependency/SBOM scan.

## Проверки, выполненные во время анализа

- `npm run check` — успешно, но проверяет только семь файлов из `tsconfig.critical.json`.
- `npm run check:production` — неуспешно: 399 TypeScript errors в 80 файлах.
- `npm run build` — успешно; Vite предупредил о chunks >500 KB и неэффективных mixed imports.
- Auth-focused Vitest:
  - `directus-session-validator.test.ts`;
  - `user-auth-session.test.ts`;
  - `oauth-response-sanitizer.test.ts`;
  - результат: 3/3 test files, 14/14 tests прошли.

Успешная сборка не опровергает TypeScript-дефекты: текущий build транспилирует код без type-check.
