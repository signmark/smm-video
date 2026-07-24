# Spec §10 — Liveness/readiness split + redacted structured logging

**Effort:** medium · **Исполнитель:** Hermes · **Ревью:** Mavis; readiness-семантика — согласовать с Mimo

## Цель

`/health` больше не врёт о готовности; логи структурированы и не светят PII/токены.

## Факты

- `server/index.ts:306` — `app.get('/health', ...)` (проверить, что он возвращает сейчас).
- `server/utils/logger.ts` — существующий логгер `log(msg, scope)`; есть тест `logger.test.ts` и `youtube-settings-log-redaction.test.ts` (прецедент redaction!).
- Известные утечки в логах: user-auth логирует URL с userId (`fetchAdminStatus: GET .../users/<id>`), console.log HTTP-мидлвара `[HTTP] method url` (index.ts:238-241) — все URL включая query.

## Шаги

1. **Health split:**
   - `/live` — только «процесс жив», всегда 200, без внешних вызовов.
   - `/ready` — проверка Directus (`GET /server/ping` или users/me c timeout 2s) + S3 доступность (HEAD bucket, опционально) → 200/503 с покомпонентным JSON.
   - `/health` оставить алиасом `/live` (обратная совместимость для существующего мониторинга Mimo) с комментарием-deprecation.
2. **Logger:** расширить `server/utils/logger.ts`:
   - `logStructured(level, scope, msg, fields?)` → JSON-строка `{ts, level, scope, msg, requestId, ...fields}` в production, human-readable в dev.
   - `redact(value)`: паттерны Bearer-токенов, `?access_token=`, email, UUID userId → `***`. Прогонять msg и fields.
   - requestId: middleware, `req.id = randomUUID()`, прокидывать в логи через AsyncLocalStorage ИЛИ (проще) явным параметром — выбрать явный параметр, ALS — это §13-материал.
3. Массовую замену `console.*` НЕ делать (сотни вызовов, шум для ревью). Scope: заменить только в горячих точках утечек: `server/middleware/user-auth.ts`, HTTP-мидлвара index.ts, `server/api/upload-image-route.ts`. Остальное — follow-up-список в handoff.
4. Пустые `catch {}` — только инвентаризация (grep + список в handoff), исправление отдельным циклом.

## Тесты

- `/live` 200 при замоканном мёртвом Directus; `/ready` 503 с `{directus:'down'}`
- redact: строка с Bearer-токеном/email/userId на выходе не содержит оригинала (паттерн `youtube-settings-log-redaction.test.ts`)
- requestId присутствует в structured-выводе

## Acceptance

- [ ] Mimo обновил post-deploy проверку на `/ready` (его профиль, pre-deploy чек-лист)
- [ ] grep лога dev-сессии: ни одного Bearer/userId в новых логгер-вызовах
- [ ] Полный vitest зелёный

## Грабли

- Существующий внешний мониторинг может дёргать `/health` — не удалять и не менять его семантику в этом цикле.
