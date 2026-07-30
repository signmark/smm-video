# Claude: закрыть findings приёмки AI-48

**Дата ревью:** 2026-07-30  
**Jira:** AI-48  
**Фактически проверенный диапазон:** `b72efe9d920e8ae4e763622268f011e1116b3f92..ba310ad85`  
**Старт для правок:** `b30334bc950e` (`origin/main` на момент передачи)  
**Вердикт:** не принято; AI-48 не закрывать до повторной приёмки.

Работай в `main` полным циклом: код → тесты с доказанным red-before →
четыре обязательные проверки → commit/push → чистая сборка → deploy → smoke.
После выкатки оставь в AI-48 один комментарий «готово к ревью» по формату
`/root/.config/jira/README.md`; промежуточными событиями Jira не засоряй.

## Что уже принято — не переделывать без причины

- VK OAuth: tenant binding, одноразовый state/TTL, повторная проверка владельца.
- Граница `trend.source_id`.
- Удаление XMLRiver из активного server/client bundle.
- Host не участвует в построении origin; callback-токен редактируется в логах.
- `randomUUID()` в путях временных видео.
- Серверная цена и денежный инвариант брони при неоднозначном ответе YooKassa
  внутри одного запроса.

## [P1] Tenant boundary скрейпера закрыта не на всех ручках

Guard добавлен только в часть `/api/scraper/*`. Следующие восемь ручек всё ещё
принимают глобальный `channelId`/`channel_ids` либо вообще возвращают глобальную
агрегацию после одного `authenticateUser`:

1. `POST /api/scraper/monitoring/channels`
2. `GET /api/scraper/channels/:channelId/posts`
3. `GET /api/scraper/channels/:channelId/best-times`
4. `GET /api/scraper/channels/:channelId/posts/dynamics`
5. `GET /api/scraper/trends/posts`
6. `GET /api/scraper/trends/hashtags`
7. `GET /api/scraper/analytics/engagement`
8. `POST /api/scraper/monitoring/scheduler/metrics-refresh`

Точки: `server/api/trends-routes.ts:2562`, `:2622`, `:2644`, `:2661`,
`:2683`, `:2705`, `:2726`, `:2748`.

Что требуется:

- операция с одним каналом проверяет его владение до обращения к скрейперу;
- операция со списком проверяет **каждый** канал, не доверяя присланному
  `channel_ids`/объекту `channels`;
- агрегаты требуют `campaignId`, проверяют доступ и сами выводят разрешённый
  набор каналов; если upstream не умеет tenant-scope (например, hashtags),
  ручку надо fail-closed отключить/перепроектировать, а не отдавать глобал;
- создание канала разрешено только для канала указанной доступной кампании;
- сравнивать пару `platform + normalized platform_channel_id`, а не один `id`.
  Сейчас `assertScraperChannelBelongsToRequester` и фильтр списка игнорируют
  platform (`trends-routes.ts:222`, `:2493-2497`);
- тесты должны использовать **реальный** `getScraperCampaignChannels`, а не
  mock с другой нормализацией Telegram (`@` сейчас теряется в тестовом mock).

Read-only сверка прода: 118 кампаний, 31 уникальный заявленный публичный канал,
14 каналов в мониторинге; 11 совпадают с декларациями, 3 не принадлежат ни одной
текущей кампании и должны оставаться fail-closed.

Red-before: таблично пройти все восемь ручек чужим каналом/кампанией и доказать,
что без каждого guard внешний scraper mock вызывается, а с фиксом — нет.

## [P1] Idempotence-Key YooKassa теряется между HTTP-запросами

`server/routes/yookassa.ts:500` создаёт новый `orderId = uuidv4()` на **каждый**
`POST /api/payments/create`. `createYookassaPayment()` повторяет POST дважды с
одним ключом только внутри этого запроса. После двух неоднозначных ответов сервер
возвращает `503 retryable`, но не возвращает/не сохраняет ключ для повтора.
`client/src/pages/pricing.tsx:359-397` при следующем клике делает новый запрос
без idempotency token — получается новый orderId и новый платёж.

Особенно опасен платёж без промокода: для него нет даже строки брони, поэтому
неоднозначно созданный платёж вообще не имеет локальной записи для сверки.

Что требуется:

- один checkout attempt получает стабильный непрогнозируемый request/order id;
- повтор **отдельного** `/api/payments/create` после timeout/503 использует тот
  же YooKassa `Idempotence-Key` и то же тело;
- ключ привязан к пользователю + тарифу + промокоду; его нельзя переиспользовать
  с другим payload;
- неоднозначный ответ возвращает клиенту тот же retry token либо сервер сам
  хранит intent и восстанавливает его;
- тест делает два отдельных Supertest-запроса (не два внутренних fetch) и
  доказывает один Idempotence-Key/один логический платёж, в том числе без promo.

## [P1] XMLRiver физически не удалён из боевого Directus

Код и bundle чистые, но read-only запрос к продовому Directus показал:

- `user_api_keys`, `service_name=xmlriver`: **5** строк;
- `global_api_keys`, `service_name=xmlriver`: **1** строка.

Удалить эти шесть записей после точной проверки targets. После удаления
повторить count: обе коллекции должны дать 0. Ключ на стороне провайдера отозвать
имеющимися доступами нельзя — это честно оставить в «НЕ сделано», если владелец
не даст доступ; удаление копий из Directus от этого не блокируется.

## [P2] Московское «сегодня» и стартовый месяц всё ещё browser-local

Исправлены drag-time и статистика часов, но остались:

- `PublicationCalendar.tsx:158` — `useState(new Date())`;
- `PublicationCalendar.tsx:220` — `toWallDateKey(new Date())`;
- `pages/posts/index.tsx:63-64` — `new Date()` и `startOfMonth(new Date())`.

Вокруг московской полуночи пользователь в UTC/New York/Tokyo получает другой
выбранный день, другой visible month и неверное условие «сегодня». В проекте уже
есть `displayTodayKey()`; нужен единый способ получить wall-Date для московского
ключа без пересчёта выбранной календарной клетки как timestamp.

Тест должен заморозить время по обе стороны московской полуночи и проверить
результат при разных `TZ`. Source-scan только на отсутствие
`getHours/getMinutes` эту ошибку не ловит.

## [P2] Fake Directus неверно моделирует `_neq` на NULL

`server/__tests__/promo-reservation-atomic.test.ts:77` считает, что
`NULL _neq true` проходит. На боевом Directus 11.2.2 проверено read-only:
из 96 строк `directus_users` одна имеет `last_access=NULL`; `_nnull` и
`_neq` заведомо другому timestamp вернули по 95, а не 96. Значит `_neq`
исключает NULL, как SQL.

Из-за этого CAS в `server/services/promo-reservation.ts:379`
(`needs_reconciliation: {_neq: true}`) не освободит nullable/legacy-строку.
Нужен явный фильтр «NULL или false» (`_or`) и fake с реальной семантикой.
Red-before обязан краснеть на `needs_reconciliation=null` без исправления
production-кода, а не только fake.

## [P2] Два новых source-scan теста зависят от системного `grep`

На Windows:

- `server/__tests__/xmlriver-removed.test.ts`;
- `server/__tests__/callback-secret-redaction.test.ts`

падают с `spawnSync grep ENOENT`. Перевести обход исходников на Node `fs`
(или общий кроссплатформенный helper), чтобы обязательный `npx vitest run`
проходил не только на Ubuntu/prod.

Локальная проверка ревью:

- целевой набор: 127 green, эти 2 теста red из-за `grep`;
- полный набор: 1935/1938; кроме двух `grep` один старый
  `storage-privilege-escalation` упёрся в 5 s при полном параллельном прогоне,
  но отдельно прошёл 9/9 — его не считать finding этого диапазона без
  воспроизведения на Linux;
- `npm run check` — green;
- `npm run check:client` — green;
- `npm run build` — green.

## Handoff metadata тоже исправить

В `docs/prompts/codex-review-request-2026-07-30-ai48.md` указан диапазон
`f41b2f355..ba310ad85`, который не включает `db5c3bfa9` и `5039a75c5`, хотя
они относятся к AI-48. Там же перечислены SHA `081fe0c68`, `f8c21e26c`,
`860b0ab96`, `d913b56b5`, `cf2818e8b`, `541dd7513`, которых нет в
`origin/main`. В следующей передаче укажи реальные SHA из `git log` и полный
новый диапазон от `b30334bc950e` до нового HEAD.

## Acceptance перед повторной передачей

1. Все P1/P2 выше закрыты кодом/данными либо явно согласованы owner'ом как
   исключение.
2. Каждый новый тест доказан red-before снятием production-правки.
3. `npx vitest run`, `npm run check`, `npm run check:client`, `npm run build`
   зелёные с числами.
4. Чистая сборка выкачена; `scripts/smoke.sh` 14/14; targeted authenticated
   tenant tests выполнены безопасно через mocks/стенд, не через чужие prod data.
5. Prod counts XMLRiver: 0 + 0.
6. Один итоговый комментарий в AI-48: диапазон, пункт→commit→finding,
   red-before, четыре проверки, prod-проверки, явное «НЕ сделано».
