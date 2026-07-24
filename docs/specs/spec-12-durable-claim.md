# Spec §12 — Durable claim + idempotency для публикации

**Effort:** high · **Исполнитель:** Hermes · **Ревью:** Mavis (архитектурное) · Блокирует §13

## Цель

Два инстанса приложения не публикуют один контент дважды; job-state переживает рестарт.

## Факты

- `server/services/publish-scheduler.ts` — главный путь публикации (memory: «N8n removal»); in-memory locks/cache.
- Хранилище — Directus/PostgreSQL (`campaign_content` со статусами scheduled/published/failed; статусная модель уже есть — memory «Video stock gate», тесты SCHEDULER_INTEGRATION).
- Directus «молча дропает поля, которых нет в коллекции» (memory!) — новые поля СНАЧАЛА создать в Directus (dev+prod), потом писать код.

## Дизайн

Атомарный claim через условный UPDATE (Directus filter):
`PATCH items/campaign_content/<id>` c `?filter[status][_eq]=scheduled&filter[claimed_by][_null]=true` → `{claimed_by: <instanceId>, claimed_at: now}`. Если Directus не поддерживает conditional update атомарно — прямой SQL через knex/pg НЕ вводить в этом цикле; вместо этого optimistic-check: перечитать запись после claim и убедиться, что claimed_by == мой instanceId (compare-and-verify). Выбор зафиксировать в handoff.

Idempotency key: `(content_id, platform, scheduled_version)`. Новое поле `scheduled_version` (int, инкремент при каждом reschedule) + таблица/коллекция `publish_attempts` с unique-ключом — перед отправкой в платформу INSERT attempt; конфликт = уже публикуется/опубликовано, скип.

Retry/backoff: attempts с `next_retry_at`, экспоненциально 1м→5м→30м, максимум 3; после — status `failed_permanent` (dead-letter), виден в UI как failed.

Claim-lease: `claimed_at` старше N минут (упавший инстанс) → claim перехватываемый.

## Шаги

1. Directus: добавить поля `claimed_by`, `claimed_at`, `scheduled_version` в `campaign_content`; коллекция `publish_attempts`. Проверить на dev И prod (schema drift!).
2. Scheduler: заменить in-memory обработанные-ID на claim-цикл; instanceId = hostname+pid+random.
3. Idempotency-гейт перед каждым platform-вызовом.
4. Retry-механика + dead-letter статус.
5. Миграционный флаг `DURABLE_CLAIM_ENABLED` (default true в dev, включение в prod — решение Mimo после smoke).

## Тесты

- **Ключевой:** два экземпляра scheduler-объекта над одним замоканным хранилищем, 100 итераций гонки за один content → публикация ровно одна (существующий паттерн SCHEDULER_INTEGRATION.test.ts)
- Claim умершего инстанса перехватывается после lease-timeout
- Повторный запуск после «рестарта» не публикует уже опубликованное
- Retry: failed attempt → next_retry_at растёт; 4-я попытка не создаётся

## Acceptance

- [ ] Гоночный тест стабильно зелёный (прогнать 10 раз)
- [ ] Поля существуют в prod-Directus ДО деплоя кода (Mimo проверяет в pre-deploy)
- [ ] Rollback-план: флаг DURABLE_CLAIM_ENABLED=false возвращает старое поведение

## Грабли

- Тайминги реального scheduler в тестах — мокать таймеры (vi.useFakeTimers), не sleep.
- Не трогать пути генерации контента (stock gate!) — только публикация.
