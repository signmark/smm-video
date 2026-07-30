# Claude: закрыть post-closure review, включая полное удаление XMLRiver

**Дата:** 2026-07-30
**Рабочая копия:** `/root/smm` на новом production-сервере
**Ветка:** `main`
**Базовый remote SHA на момент постановки:** `b72efe9d920e8ae4e763622268f011e1116b3f92`
**Jira:** `AI-48` под эпиком `AI-44`; существующие отдельные хвосты — `AI-33` и `AI-34`

Работай напрямую в `/root/smm` и `main`. Ты единственный разработчик: самостоятельно исправь код, протестируй, закоммить, отправь в `origin/main`, задеплой и проверь production.

Сначала прочитай:

- `AGENTS.md`;
- `docs/agents/codebase-map.md`;
- `docs/DEPLOYMENT.md`;
- `docs/prompts/codex-review-request-2026-07-29-post-closure.md`;
- `docs/followups/2026-07-29-release-closure-handoff.md`.

Синхронизация:

```bash
git fetch origin --prune
git merge --ff-only origin/main
git status --short
```

Не используй `git pull`. Не трогай и не коммить `.mimocode/.cron-lock`, `.mimocode/plans/*` и пользовательские дампы/локальные файлы. Работай только на новом сервере `/root/smm`; старый `omemo.tech` не используй ни для деплоя, ни как доказательство проверки.

## 1. Полностью удалить XMLRiver

Уточнение владельца: XMLRiver не нужно чинить. Интеграцию договорились полностью удалить.

Удалить всю рабочую интеграцию:

- удалить `server/api/xmlriver-routes.ts`;
- удалить `server/services/xmlriver-client.ts`;
- удалить импорт, регистрацию и startup-log XMLRiver из `server/index.ts`;
- удалить XMLRiver из типов, маппингов и специальной обработки ключей:
  - `server/services/api-keys.ts`;
  - `server/services/global-api-keys.ts`;
  - `client/src/lib/api-service-types.ts`;
  - `client/src/lib/utils.ts`;
- полностью убрать секцию настройки XMLRiver, state, validation, сохранение и тестирование ключа из `client/src/components/SettingsDialog.tsx`;
- удалить устаревший XMLRiver-диалог и связанные state/imports из `client/src/components/KeywordSelector.tsx`: поиск ключевых слов уже должен работать через `/api/keywords/search`;
- удалить поддержку XMLRiver из `test_scripts/utils/run-test-api-keys.js`;
- обновить актуальную документацию API и хранения ключей;
- проверить конфиги, env-примеры, Swagger, тесты и остальные активные файлы на связанные хвосты;
- не переписывать git history и не редактировать исторические архивы только ради удаления упоминаний.

После удаления в активном коде не должно остаться:

- маршрутов `/api/xmlriver/*`;
- обращений к `xmlriver.com`;
- hardcoded XMLRiver credentials;
- типов, UI, настроек, логов и тестовых утилит XMLRiver;
- внутренних HTTP-loopback запросов из XMLRiver-кода.

Добавь регрессионный тест, который без удаления краснеет, а после удаления подтверждает отсутствие регистрации XMLRiver и активных исходников/ссылок. Удалённые `/api/xmlriver/*` должны возвращать 404.

Отдельно проверь `/root/.env`, показывая только имена переменных и никогда не печатая значения. Если там есть исключительно XMLRiver-переменные, удали их с предварительной резервной копией файла.

Проверь Directus на записи `service_name = xmlriver` в коллекциях пользовательских/глобальных API-ключей. Перед удалением зафиксируй только количество записей без вывода секретов, сделай резервную копию и удали только XMLRiver-записи. Никакие другие API-ключи не трогай. Если отозвать ключ на стороне провайдера невозможно из имеющихся доступов, явно укажи это в финальном отчёте. Общую ротацию остальных credentials не начинай.

## 2. VK OAuth: закрыть cross-tenant overwrite

В `server/routes/vk-oauth.ts`:

- перед созданием state проверять владение `campaign_id`;
- привязать state к authenticated user ID;
- повторно авторизовать campaign/user в callback перед admin GET/PATCH;
- удалить legacy `/vk/auth` либо привести его к тем же требованиям;
- запретить неподписанный base64 state, произвольный redirect URL и утечку токенов;
- убрать построение callback URL через прямой `req.get('host')`, использовать доверенный public-origin utility.

Добавить attacker/victim тесты. Без исправления они обязаны краснеть.

## 3. Закрыть tenant boundary в trends/scraper

Исправить:

- `POST /api/trends/collect-direct`;
- `GET /api/scraper/monitoring/channels?campaignId=...`;
- DELETE/force-parse scraper channel;
- sync-campaign;
- admin-token fallback в `trend-collector.ts`.

Каждая campaign/channel operation должна подтверждать владение текущего пользователя. Для channel сначала установить связь channel → campaign → owner. Добавить табличные attacker/victim тесты.

## 4. YooKassa: fail-closed при неопределённом результате create

В `server/routes/yookassa.ts` и `server/services/promo-reservation.ts`:

- idempotency key должен быть стабильным для одного `orderId`;
- повтор create выполняется с тем же body/key;
- различать определённый отказ и неоднозначный network timeout/5xx;
- при неоднозначном результате не освобождать бронь, а помечать её для reconciliation;
- `markPaymentAttempt` и `attachPaymentId` должны бросать ошибку при отсутствии ожидаемой строки, а не молча возвращаться;
- добавить тест сценария «YooKassa приняла платёж, но ответ потерялся».

## 5. Убрать оставшийся direct Host

После полного удаления XMLRiver проверить весь runtime-код на прямое использование `req.get('host')`/Host для построения URL. Исправить legacy VK через доверенный public-origin resolver. Добавить source-scan regression test.

## 6. Не логировать секрет callback path

В trends callback-логах не выводить полный URL с HMAC path token. Логировать только безопасную часть URL. Расширить redactor и тесты для opaque hex-secret в path.

## 7. Завершить Moscow timezone migration

Исправить локальные `Date`/`getHours`/`getMinutes` в:

- `client/src/components/PublicationCalendar.tsx`;
- `client/src/pages/posts/index.tsx`.

Today/date grouping/drag-and-drop должны использовать `Europe/Moscow` независимо от timezone браузера. Добавить тесты минимум для `TZ=UTC` и одной не-UTC зоны; тест drag-and-drop должен подтверждать сохранение московского времени.

## 8. Исключить collision временных имён видео

В:

- `server/routes/video.ts`;
- `server/routes/videoProcessing.ts`

не использовать один `Date.now()` как уникальный идентификатор. Использовать `randomUUID()` или эквивалент. Добавить конкурентный тест с замороженным `Date.now()`, подтверждающий разные пути файлов.

## 9. Сделать promo Directus fake реалистичным

В `server/__tests__/promo-reservation-atomic.test.ts` реализовать корректную обработку минимум `_eq`, `_neq`, `_null`, `_nnull`, включая nullable-поля. Добавить детерминированный race-тест для `needs_reconciliation`.

## Порядок работы

- Сначала воспроизведи каждую проблему тестом.
- Новый тест должен краснеть без исправления.
- Затем внеси минимально достаточное исправление.
- Делай небольшие тематические коммиты.
- Не останавливайся после анализа.

Обязательные проверки перед push:

```bash
npx vitest run
npm run check
npm run check:client
npm run build
git diff --check
git status --short
```

После зелёных проверок:

```bash
git push origin main
```

Затем самостоятельно задеплой по `docs/DEPLOYMENT.md`:

```bash
docker compose -f /root/docker-compose.yml build smm
docker compose -f /root/docker-compose.yml up -d smm
```

Production-проверки:

- контейнер `smm` поднялся;
- в логах есть успешный старт и Directus health;
- `https://smm.nplanner.ru/` возвращает 200;
- старые `/api/xmlriver/*` возвращают 404;
- рабочий `/api/keywords/search` не зависит от XMLRiver;
- по ASCII-маркеру в собранном bundle подтверждено, что уехала новая версия;
- security-sensitive endpoints без авторизации возвращают ожидаемые 401/403/404.

Обнови `AGENTS.md` и release-handoff фактическими коммитами, результатами тестов и деплоя.

В финальном отчёте перечисли:

- коммиты и push;
- какие замечания закрыты;
- что именно удалено по XMLRiver;
- количество удалённых XMLRiver key records без раскрытия значений;
- red-before/green-after тесты;
- результаты четырёх обязательных проверок;
- production deployment и live-checks;
- оставшиеся риски, если они действительно есть.

Jira веди по `/root/.config/jira/README.md`: не комментируй и не меняй статусы по ходу. Только после push, deploy и live-check добавь один короткий итоговый комментарий в `AI-48` с коммитами и проверками и переведи задачу в «Готово». Если в этом же заходе фактически закрыты `AI-33`/`AI-34`, для каждой также допустим только один итоговый комментарий и один переход после production-проверки.

Не проси владельца выполнить push или deploy. Не останавливайся, пока код, тесты, push, deployment и live-проверки не завершены.
