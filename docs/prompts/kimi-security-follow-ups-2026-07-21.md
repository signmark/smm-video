# Follow-ups после волны security/Task 10 (Kimi, 2026-07-21)

**Адресаты:** Mavis (ревью + пуш), далее Codex/Claude по назначению владельца.
**Статус:** очередь; приоритеты расставляет владелец.

## 0. Ревью и пуш (Mavis, первым шагом)

Волна 2026-07-21 закоммичена, тесты точечные зелёные. Перед пушом — ревью:

| Коммит | Что внутри | Кто автор правок |
|---|---|---|
| `e2f721e` | Task 10: удалены `social/telegram-proxy-service.ts` (613 строк) и каскадно `services/media-proxy-service.ts` (139 строк); чистка `KNOWN_DEAD` в `social-facade-imports.test.ts` | Kimi |
| `fdc40a3` | YouTube: redaction логов в `publishing-routes.ts`, `campaign-youtube-settings.ts`, `youtube-auth.ts` | Kimi (закоммитил Mavis fallback) |
| `ab24f05` | YouTube: redaction в `social/index.ts`, `youtube-token-refresh.ts` | Kimi (закоммитил Mavis fallback) |
| `281d780` | Redaction логов: instagram/vk/tiktok/facebook/telegram/threads (11 файлов) | Kimi |
| `b2f908b` | Остаточные утечки (по observation Mavis `mavis-residual-leaks-2026-07-21.md`): 5 точек + 5 найденных догрепом — префиксы/длины токенов → булевы флаги; `facebook-service.ts`, `vk-token-refresh.ts`, `telegram-bot/index.ts`, `storage.ts`. **Observation Mavis закрыто.** | Kimi |
| `1e54f7d` | Регрессионные тесты инварианта redaction по конвенции `TESTING_AS_DOCUMENTATION.md`: `youtube-settings-log-redaction.test.ts` (6/6), хелпер `expectNoTokenLeak`, покрыты GET `/youtube-settings` и POST `/api/test-youtube-publish` | Kimi |
| `8bb84f2`, `8bfdd35` | Docs: исход Task 10, статус security redaction | Kimi |

**Чек-лист ревью:**
1. Дифы только в log-строках / удалённых файлах / docs — логика OAuth-flow и refresh не менялась.
2. Контрольный grep: `git grep -nE "(accessToken|refreshToken|appSecret|client_secret).{0,60}(console\.|log\()" server/` — не должно быть прямых выводов значений (флаги `hasToken`/`hasAccessToken` — ок).
3. Полный vitest прогон (точечные: facade 11/11, платформы 67/67 + jest facebook 11/11, youtube 3/3; полный прогон после всех коммитов ещё не делался).
4. Smoke: открыть настройки YouTube кампании в UI → в `docker logs smm` не должно быть `accessToken`/`refreshToken`.

## 1. 🚨 Ротация YouTube OAuth credentials — ВЛАДЕЛЕЦ, не агент

Токены, утёкшие в исторические docker-логи до `fdc40a3`, валидны до отзыва. Redaction логов компрометацию НЕ закрывает. Действие владельца: переавторизация YouTube в затронутых кампаниях (+ опционально настроить ротацию `logging` в `deploy/docker-compose.yml` — секция logging сейчас отсутствует, логи копятся на диске хоста).

## 2. Кандидаты в таски (нужен выбор владельцем, кому)

### 2.1 `/youtube-settings` эндпоинт — токены в HTTP + нет auth (high)
- `server/routes/campaign-youtube-settings.ts:44-47` (GET) и `:127` (PATCH) отдают `accessToken`/`refreshToken` в ответе.
- Роутер смонтирован **дважды** и оба раза без auth-middleware: `server/index.ts:331-333` и `:766-768`; fallback на `process.env.DIRECTUS_TOKEN` (строка ~16 файла роута).
- Клиент токены ИСПОЛЬЗУЕТ: `client/src/components/SocialMediaSettings.tsx:954-958`, `client/src/components/YouTubeSetupWizard.tsx:52-53,66,181-182,195` — простое удаление токенов из ответа сломает UI.
- Предлагаемый путь: sanitized-эндпоинт для UI (без токенов) + auth-middleware + снять двойной маунт; токены клиенту не нужны для отображения (только `channelId`/`channelTitle`/`configured`), а round-trip токенов через форму заменить на серверное хранение.
- **Out of scope:** сам redaction логов (сделан), ротация (владелец).

### 2.2 Facebook: полный `user_token` клиенту (high)
- `server/routes/facebook-pages.ts:185-186` — каждая страница возвращается с `access_token` (page token) и `user_token` (полный пользовательский токен!). Уточнить, что реально нужно фронту выбора страницы, и урезать.
- Смежно: `facebook-debug.ts:79-83` и `facebook-groups-discovery.ts:63-74` отдают page access_token в ответах; `instagram-oauth.ts:342` — `longLivedToken` в ответе OAuth callback.

### 2.3 Хардкод-секреты и обходы (medium)
- `server/routes/instagram-test.js:20` — захардкоженный пароль в исходнике → вынести в env.
- `server/routes/youtube-auth.ts:121-126` — fallback на захардкоженный тестовый userId при неизвестном OAuth state → обход привязки OAuth к пользователю, убрать или ограничить dev-окружением.

### 2.4 Техдолг (low, не блокеры)
- `server/routes/instagram-setup-wizard.ts` — частично сломан: `Cannot find name 'directusApiManager'` (строки ~306, 459, 500, 536, 560, 586); либо дописать, либо удалить/архивировать.
- `tsc -p tsconfig.json` — 451 pre-existing ошибка (после Task 10 стало на одну меньше). Отдельный big-bang не предлагать; резать по каталогам.

## Правила для исполнителей

- Каждый пункт — отдельный коммит, не смешивать между собой и не смешивать с рефакторингом.
- Перед началом 2.1/2.2 свериться с клиентом (`client/src`): что UI реально читает из ответов.
- Исторические промпт-доки не переписывать; статусы — в `docs/prompts/README.md` и `docs/session-*.md`.
