# Handoff: Claude — security §2, §4, §5 — 2026-07-24

## Задача

По поручению owner'а (Dmitry): закрыть три low-effort пункта security-беклога (`docs/followups/2026-07-24-security-backlog.md`) силами Claude до конца доступа. Рекомендованный порядок беклога соблюдён: §2 → §4 → §5.

## Коммиты

| Hash | Что | Файлы |
|---|---|---|
| `47d95938` | §2 admin-only scheduler | `server/middleware/user-auth.ts` (+`requireSmmAdmin`), `server/api/publishing-routes.ts`, новый `server/__tests__/scheduler-admin-gate.test.ts`, моки в 4 существующих тест-файлах |
| `9cfa3a1f` | §4 upload hardening + §5 WS temp close | новый `server/api/upload-image-route.ts`, новый `server/utils/ws-gate.ts`, `server/index.ts` (wiring), 2 новых тест-файла |

## Что сделано

- **§2:** `toggle-publishing` и `reset-processed-cache` — только POST + `requireSmmAdmin` (403 для не-админа, 401 anonymous, GET теперь 404). Любой пользователь больше НЕ может останавливать публикации всех tenants.
- **§4:** `/api/s3/upload-image` — multer limits 10MB/1 файл (413), MIME allowlist + magic bytes sniffing JPEG/PNG/WebP/GIF (415, включая подмену содержимого), S3 key генерируется на сервере (client originalname исключён из key — path traversal/injection закрыт), клиент получает generic-ошибки без internal `error.message`.
- **§5 (low-вариант):** `/ws` в production отклоняет upgrade (403 + destroy). Явный override `WS_PUBLIC_EVENTS_ENABLED=true`. Dev/test и Vite HMR не затронуты. Full-вариант (session-validated, user-scoped WS) — остаётся в беклоге как §5-medium.

## Верификация (мой прогон, Windows, 2026-07-24 ~18:35 MSK)

- `npx vitest run`: **86/86 файлов, 904/904 тестов** зелёные (база выросла с ~717 — параллельные агенты активно добавляют тесты)
- `npx tsc -p tsconfig.critical.json`: **exit 0**
- Новые регрессионные тесты: 8 (§2) + 9 (§4) + 4 (§5) = 21; негативные сценарии покрыты (anonymous/non-admin/GET/oversized/spoofed/secret-leak)
- Тест «падает без фикса» проверен от противного: базлайн-прогон со stash моих правок ловил старое поведение

## Компромиссы и отклонения

1. **§4+§5 в одном коммите** — оба меняют `server/index.ts`, раздельное стейджирование ханков не стал делать на живом репо с параллельными агентами. Отклонение от «1 пункт = 1 коммит» зафиксировано здесь.
2. **`toggle-publishing` принимает `enable` из body И query** — обратная совместимость для админских скриптов; мутация всё равно только POST.
3. **UI не затронут:** grep по `client/` — эндпоинты §2 фронтом не используются; upload использует поле `image` как раньше.
4. **Обнаружен пробел:** `x-user-id` в CORS allowedHeaders + fail-open subscription — §6/§14, не трогал.

## Вопросы к ревьюеру / owner'у

Нет блокирующих. Mimo при деплое: убедиться, что prod-клиенты не зависят от `/ws` (иначе временно выставить `WS_PUBLIC_EVENTS_ENABLED=true` и записать это решение).

## Следующий шаг

1. **Mavis:** ревью обоих коммитов по протоколу; обновить `docs/followups/2026-07-24-security-backlog.md` (§2, §4, §5-low → ✅ CLOSED с hash'ами), captain's log.
2. **Mimo:** деплой по обычному циклу, post-deploy smoke: POST toggle-publishing non-admin = 403, upload не-изображения = 415, wss:///ws в prod = отказ.
3. **Hermes:** следующий по беклогу — §7 (CI regression suite) или §6 (fail-closed) по спекам в `docs/specs/` (создаются следом).
