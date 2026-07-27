# Closeout: ответ на follow-up Codex по d4fadb37 — 2026-07-27

**Старт:** origin/main@4e76a516. **Основной прошлый фикс:** d4fadb37.
**Этот цикл:** закрытие двух P2 + двух ранее открытых вопросов из follow-up Codex.

## Коммиты (атомарные, в origin/main)

| # | Hash | Суть |
|---|------|------|
| 1 | `d0c39146e` | content guard: классификация ошибок (403/404→404, timeout/5xx/сеть→503) + route-level tenant тесты |
| 2 | `a3acdbe88` | body-parser: 1mb только на публичные callback, обычные /api → до 50mb |
| 3 | `325d96136` | VK token-webhook: одноразовый state + tenant-защита status/reconnecting + rate limiter |
| 4 | (этот файл) | docs/closeout |

## Таблица находок

| Finding | Файл / строки | Тест | Commit | Prod-evidence | Статус |
|---|---|---|---|---|---|
| P2: ошибка первого service GET → всегда 404 (fail-open по смыслу) | `server/services/content-access.ts` (catch первого GET) | `publish-tenant-boundary.test.ts` — 404→404, 403→404, 500→503, network→503 (14/14) | `d0c39146e` | маркер `assertContentBelongsToRequester` в bundle ✓; live — PENDING deploy | CODE-COMPLETE |
| P2: тесты не доказывали, что роуты вызывают guard | 7 роутов (FB/stories×2/social/publish-now/retry) | `publish-tenant-boundary-routes.test.ts` (7/7) + mutation-proof | `d0c39146e` | — | CODE-COMPLETE |
| Open: body-parser 1mb перехватывал весь /api | `server/index.ts`, `server/middleware/public-oauth-bypass.ts` | `public-oauth-bypass-body-limit.test.ts` (4/4: callback parsed, callback>1mb→413, /api 1–50mb→200, >50mb→413) | `a3acdbe88` | маркер `registerPublicOAuthBypass` в bundle ✓; live — PENDING deploy | CODE-COMPLETE |
| Open: публичный VK webhook мимо auth, admin PATCH по campaignId из URL | `server/routes/vk-oauth.ts`, `server/services/vk-webhook-state.ts` | `vk-webhook-state.test.ts` (5/5), `vk-token-webhook.route.test.ts` (9/9) + mutation-proof | `325d96136` | маркеры `consumeVkWebhookState`, `token-webhook/:campaignId/prepare` в bundle ✓; live — PENDING deploy | CODE-COMPLETE |
| Open: VK status публичный по campaignId | `server/routes/vk-oauth.ts` status GET | `vk-token-webhook.route.test.ts` — no-auth→401, foreign→404, Directus down→503, owner→200 | `325d96136` | live — PENDING deploy | CODE-COMPLETE |

**Почему не CLOSED:** production-evidence (container/bundle/live-smoke) требует реального деплоя. Мой `docker compose build/up` блокируется классификатором среды (см. память `smm-prod-deploy-howto`) — деплой выполняет владелец. До выкатки статус CODE-COMPLETE, не CLOSED.

## Проверки (перед push)

- `npm run check` (tsc critical) — ✓
- `npm run build` — ✓ (фронт+сервер собраны)
- `npx vitest run` — **98 файлов, 1044 теста, зелено** (было 94/1016; +4 файла, +28 тестов)

## Mutation-proof (AGENTS.md: тест обязан краснеть без фикса)

1. **Route tenant guard:** снят `assertContentBelongsToRequester` из `social POST /api/content/:id/publish` → route-тест покраснел (200 вместо 404, PATCH вызван); guard возвращён → зелено.
2. **VK state gate:** `if (!consumed.ok)` → `if (false && !consumed.ok)` → 4 route-теста VK покраснели (без state → 200, PATCH вызван); фикс возвращён → зелено.

## Деплой (выполняет владелец)

```bash
docker compose -f /root/docker-compose.yml build smm && docker compose -f /root/docker-compose.yml up -d smm
```

После — обычная перезагрузка страницы (SPA сама не обновится).

### Post-deploy evidence checklist (заполнить после выкатки)

- [ ] контейнер `smm` Up
- [ ] Directus health OK
- [ ] `https://smm.omemo.tech/` → 200
- [ ] ASCII-маркеры в prod-bundle: `curl -s https://smm.omemo.tech/assets/index-*.js` не отдаёт JS (маркеры в server bundle, не в клиентском) — проверять в контейнере: `docker exec smm grep -c consumeVkWebhookState dist/server/index.js`
- [ ] negative live-smoke (неразрушающе):
  - anonymous Facebook publish отклонён: `curl -s -o /dev/null -w "%{http_code}" -X POST https://smm.omemo.tech/ -H 'Content-Type: application/json' -d '{"contentId":"x"}'` → ожидаем 401
  - VK callback без state отклонён: `curl -s -o /dev/null -w "%{http_code}" -X POST 'https://smm.omemo.tech/api/vk/token-webhook/test-campaign' -H 'Content-Type: application/json' -d '{"access_token":"x"}'` → ожидаем 401

## ⚠️ Требует внимания владельца: контракт needanapp

VK-фикс меняет рабочий процесс: раньше в needanapp сохранялся **один статичный**
webhook URL и переиспользовался при каждом реконнекте (~раз в 24ч). Теперь URL
содержит **одноразовый state** — на каждое подключение фронт готовит свежий URL
(prepare), и пользователь заново вставляет его в needanapp; старый сохранённый URL
без state будет отклонён (401).

- **State передаётся как `?state=` в query.** Это тот же механизм, что уже
  round-trip'ится для `state` в `/vk/oauth2/callback`, поэтому ожидаемо работает.
  **Но реальный needanapp-раунд я проверить не могу** — нужно, чтобы владелец
  один раз прошёл полный путь (prepare → вставить URL в needanapp → получить токен)
  и убедился, что токен сохраняется. Если needanapp срежет query-параметр —
  переносим state в сегмент пути (fallback описан ниже).
- **Fallback, если query срезается:** сменить путь на
  `/api/vk/token-webhook/:campaignId/submit/:state` (сегмент пути needanapp
  срезать не может). Изменение локальное: `PUBLIC_OAUTH_CALLBACKS` (publicPath/
  routerPath), сам роут в `vk-oauth.ts` и генерация URL в `prepare`.

## Открытых пунктов из follow-up Codex не осталось (все CODE-COMPLETE, ждут deploy).
