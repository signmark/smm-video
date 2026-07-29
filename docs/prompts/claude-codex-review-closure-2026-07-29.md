# Handoff: Claude — закрытие находок ревью Codex — 29.07.2026

## Задача

Закрыть release blockers повторного ревью Codex по диапазону
`c3f85c069~1..745fcf568`: межтенантную отмену/чтение публикаций через storage
fallback, несвязанную проверку `campaignId`/`trendId`, освобождение
reconciliation-брони живого платежа, TOCTOU слотов, фиксированный бюджет
безлимитного промокода и оставшиеся локальные границы дня после SM-9.

Источник: `docs/reviews/codex-review-2026-07-29-release-blockers.md`,
исполнительский prompt: `docs/prompts/claude-fix-codex-review-2026-07-29.md`.

Полный цикл: код → краснеющие без фикса тесты → все проверки → commit → push в
`origin/main` → deploy по `docs/DEPLOYMENT.md` → smoke на `smm.nplanner.ru`.

## Коммиты

| Hash | Сообщение | Файлы |
|---|---|---|
| `541191c35` | fix(security): пользовательский путь больше не дочитывает и не дописывает чужое | `server/storage.ts`, `server/api/publishing-routes.ts`, `server/api/social-publishing-router.ts`, `server/services/promo-reservation.ts`, `server/routes/yookassa.ts`, `client/src/lib/date-utils.ts`, `client/src/pages/posts/index.tsx`, 6 тестовых файлов |
| `167b5ab6f` | fix(billing): бронь на разборе не реклеймится, TOCTOU не даёт ложного «исчерпан» | `promo-reservation.ts`, `yookassa.ts`, `promo-reservation-atomic.test.ts`, `scripts/directus/create_payment_collections.js` |
| `d240dcecb` | fix(security): граница арендатора в трендах и аутентификация колбэков | `trends-routes.ts`, `webhook-auth.ts`, `trend-collector.ts`, 3 тестовых файла |

`167b5ab6f` и `d240dcecb` были готовы локально к началу этой сессии и не были
запушены; они закрывают P1 №2 и P1 №3 и вошли в этот же выкат.

**Замечание про старт сессии.** `git merge --ff-only origin/main` из prompt'а не
проходил: локальный `main` разошёлся с `origin/main` (два готовых коммита против
одного docs-коммита `282d63b31`). Разрешено `git rebase origin/main` — конфликтов
не было, ни одна чужая правка не потеряна.

## Что сделано

**P1 — cross-tenant отмена и чтение публикаций (`541191c35`).**
`storage.getCampaignContentById` после отказа переданного токена шёл по лесенке
из четырёх попыток: тот же токен повторно → перебор `tokenCache` ВСЕХ
пользователей → анонимный запрос. Так как `getAuthToken(любойUserId)` отдаёт
`DIRECTUS_SERVICE_TOKEN`, третья ступень означала «403 пользователя — дочитаем
служебным токеном». `updateCampaignContent` без токена сам находил владельца и
брал его же служебный токен.

Изменено: пользовательские методы требуют токен и **не эскалируют никогда**;
служебный доступ вынесен в `getCampaignContentByIdPrivileged` и
`updateCampaignContentPrivileged`. Фоновые вызовы переведены на них явно —
поведение фона не изменилось (служебный токен приходил туда и раньше, просто
окольным путём). `/api/publish/cancel/:id` и `/api/publish/status/:id` зовут
`assertContentBelongsToRequester` до любого чтения и записи; токен запросившего
больше не кешируется под `userId` из непроверенной записи; запись идёт тем же
токеном пользователя.

**P1 — trend/source привязаны к фактической кампании (`d240dcecb`).**
`assertTrendsBelongToRequester` / `assertTrendBelongsToRequester` /
`assertSourceBelongsToRequester` загружают объект сервером и авторизуют его
фактическую `campaign_id`. Смешанный список own+foreign отклоняется целиком до
отправки задания скрейперу. В `analyze-comments` при `level=source` источник
берётся из уже авторизованного тренда, а не из тела запроса.

**P1 — reconciliation-бронь fail-closed (`167b5ab6f` + `541191c35`).**
Маркер `payment_attempt_at` ставится ДО обращения к ЮКассе и отличает «упали до
создания платежа» от «платёж создан, привязать не смогли»; `isSlotHolderDead` не
считает мёртвой ни помеченную бронь, ни бронь с начатой оплатой;
`reclaimDeadReservations` пропускает брони на разборе, и это же условие уехало в
фильтр CAS-перехода `releaseRow`. Добавлено в этой сессии: `yookassa_payment_id`
сохраняется ТЕМ ЖЕ PATCH, что и пометка на разбор — иначе расхождение нечем
разбирать руками. Если совместная запись не прошла, последний заход пишет один
маркер: без него реклеймер снова считает бронь своей, и это дороже потери id.

**P2 — TOCTOU слота (`167b5ab6f`).** Убран безусловный `occupied.add(slot)`
после перечитывания фактической занятости.

**P3 — скрытая ёмкость безлимитного промокода (`541191c35`).**
`UNLIMITED_SLOT_ATTEMPTS = 200` был лимитом у кода, объявленного без лимита.
Критерий сменён на наблюдаемый прогресс: пока занятость слотов меняется между
попытками — ждём; 100 попыток подряд без изменений — retryable-ошибка. Код с
`max_uses` сохраняет прежний потолок `max_uses + 100`.

**P2 — остаток SM-9 (`541191c35`).** Календарь и дашборд перевёл на московские
сутки `701526e04` — он **вне диапазона ревью**, поэтому находка описывала и их;
фактически оставалась `client/src/pages/posts/index.tsx`. Там один
`dayKey = format(date,'yyyy-MM-dd')` применялся И к моментам времени, И к клеткам
календаря. Разведено: момент → `toDisplayDateKey` (московские сутки), клетка →
`toWallDateKey` (не трогаем). Выбор ближайшей даты с постами больше не идёт через
локальные `isSameDay`/`startOfDay` (они и не импортируются — это стережёт тест).
Формат времени перестал парсить строку голым `new Date()`: нормализация вынесена
в экспортируемый `normalizeTimestamp` из `date-utils`.

**video-temp.** Обходов не найдено — код не менялся, добавлен только табличный
перебор.

## Верификация (мой прогон)

- `npx vitest run`: 145/145 файлов, 1860/1860 тестов, ~90 с
  - **Дельта против baseline этой сессии**: было 138/138 файлов, 1773/1773
    теста; +7 файлов и +87 тестов (часть — из параллельной работы другого
    исполнителя, см. «Компромиссы»)
- `npm run check` (tsc, critical): exit 0
- `npm run build`: exit 0
- `npm run check:client`: **15 ошибок** при зафиксированном baseline 17. Новых
  нет, ни одной в затронутых файлах. Две ушли вне этой работы — не маскировал и
  не приписываю себе.

**Новые регрессионные тесты и их краснота без фикса** (проверено снятием правки
через адресный `git stash push -- <файл>`, для `trends-routes.ts` — подстановкой
дореформенной версии файла из `282d63b31`):

| Файл | Тестов | Красных без фикса |
|---|---|---|
| `server/__tests__/storage-privilege-escalation.test.ts` | 9 | 8 |
| `server/__tests__/promo-slot-budget.test.ts` | 3 | 1 (ровно та, что про потолок 200) |
| `client/src/lib/__tests__/posts-page-day-boundaries.test.ts` | 9 | 8 |
| `server/__tests__/promo-reservation-atomic.test.ts` (2 новых) | +2 | 1 |
| `server/__tests__/trends-tenant-boundary.test.ts` | 19 | 15 |
| `server/__tests__/api-auth-gate.test.ts` (табличный video-temp) | +21 | 0 — обходов нет, это и проверялось |

Самый показательный красный: без фикса `POST /api/publish/cancel/<чужой-uuid>`
возвращает **200** и переводит чужую запись в `draft`. С фиксом — 404, и ни
прямого, ни служебного PATCH не происходит.

**Негативные сценарии на живом проде** (`https://smm.nplanner.ru`, без сессии,
без мутаций чужих данных):

| Запрос | Ответ |
|---|---|
| `POST /api/publish/cancel/<uuid>` | 401 |
| `GET /api/publish/status/<uuid>` | 401 |
| `GET /api/campaigns` | 401 |
| `GET /api/video-temp/<uuid>` | 404 (правило работает: дошло до handler'а, видео протухло) |
| `POST /api/video-temp/<uuid>` | 401 |
| `GET /api/video-temp/<uuid>/../campaigns` | 401 |
| `POST /api/trends/{collect-trends-callback,collect-comments-callback,tg-webhook}` | 401 |
| `GET /api/{trend-comments,trend-sentiment}/x`, `/api/trends/collect-direct` | 401 |

## Деплой

По `docs/DEPLOYMENT.md`: `build smm` → `up -d smm`, compose-файл подтверждён как
`/root/docker-compose.yml`.

- контейнер `smm` поднялся, `=== SERVER SUCCESSFULLY STARTED ON PORT 5000 ===`
- `✅ [Directus Health] Directus доступен и работает`
- `https://smm.nplanner.ru/health` → 200, `/` → 200
- ASCII-маркеры в бандле: `getCampaignContentByIdPrivileged` ×6,
  `updateCampaignContentPrivileged` ×4, `assertContentBelongsToRequester` ×20,
  `NO_PROGRESS_ATTEMPTS`/сообщение о попытках без изменений ×3
- клиент: отдаваемый `/assets/index-DxbFtiD9.js` присутствует в свежем образе,
  `date-utils-BKsmSAhc.js` содержит `Europe/Moscow`; образ `ab3a7e8dd082`,
  собран 17:21:37Z

`omemo.tech` не проверялся — DNS ведёт на старый сервер.

## Компромиссы и отклонения

- **`git merge --ff-only` заменён на `git rebase origin/main`** — ветки
  разошлись, ff был невозможен. Ничего не потеряно.
- **В рабочем дереве параллельно работал другой исполнитель** (токены соцсетей в
  query-строке, контракт загрузки видео, `getBaseUrl`/Replit в
  `trends-routes.ts`). Его файлы не трогал и не коммитил; в индекс попали ровно
  13 моих файлов. К моменту коммита он свои правки закоммитил сам
  (`d5294ce39`, `1106390cc`), поэтому в образ не уехало ничего висячего, кроме
  двух незакоммиченных строк в `trends-routes.ts` про `REPLIT_DEV_DOMAIN` —
  проверил, что переменная не задана ни в `/root/.env`, ни в контейнере, то есть
  на проде это no-op. Отдельно предупреждаю: сборка идёт из рабочего дерева, и
  при живом параллельном исполнителе это системный риск.
- **Слабый тест удалён, а не оставлен «для галочки».** Добавленный было
  «210 параллельных запросов» в `promo-reservation-atomic.test.ts` зеленел и без
  фикса (в фейковом Directus запросы почти не конкурируют, до потолка не
  доходит ни один). Заменён на прямой `promo-slot-budget.test.ts`, где конфликт
  форсируется и старый код падает ровно на 201-й попытке.
- **Часть SM-9-теста сделана по исходнику** (`readFileSync` + проверка, что
  `isSameDay`/`startOfDay` не импортируются). Раскладка по дням живёт внутри
  React-компонента; рендерить страницу ради этого дороже, а прецедент в проекте
  есть (`topbar-encoding`, `social-facade-imports`, `video-upload-contract`).
- **`flagReservationReconciliation` при неудаче совместной записи делает второй
  заход одним маркером.** Формально handoff требовал «id вместе с состоянием»;
  выбран fail-closed: если совместный PATCH не прошёл, пометка важнее id, потому
  что без неё бронь снова становится добычей реклеймера.
- **`retry-and-clone.test.ts`**: добавлен мок `content-access`. Этот файл про
  инвалидацию кеша, Directus в нём не поднят; настоящая проверка владения
  гоняется в `storage-privilege-escalation.test.ts`.

## Известные ограничения / не сделано

- Пункты из раздела DO NOT FIX исходного handoff'а не трогались, кроме тех, что
  оказались уже закрыты чужими коммитами; список в `CLAUDE.md` обновлён по факту
  проверки на проде, а не по памяти.
- CI/CD не делался — по прямому указанию handoff'а.
- Остаток `check:client` (15 ошибок) не трогал: ни одна не в затронутых файлах.
- Ротация утёкших кредов (`BEGET_S3`, `DIRECTUS_ADMIN_TOKEN`) — по-прежнему
  решение владельца, не инициировал.

## Вопросы к ревьюеру / owner'у

Нет. Спорные места разрешены в сторону fail-closed и описаны выше.

## Следующий шаг (по ролям)

- **Codex:** повторное ревью диапазона `282d63b31..541191c35` по запросу
  владельца. Наибольшего внимания стоят: разделение
  пользовательских/служебных методов в `server/storage.ts` (не осталось ли
  вызова, который молча потерял доступ) и прогресс-критерий в `reservePromo`.
- **Claude:** по вердикту Codex — правки; иначе следующий раунд из
  «Известные незакрытые» в `CLAUDE.md`.
- **Owner (Dmitry):** smoke в браузере — отмена запланированной публикации,
  страница «Публикации» на границе суток, оплата с промокодом.
- **DO NOT FIX:** параллельная работа другого исполнителя в
  `server/api/trends-routes.ts` (`getBaseUrl`/`REPLIT_DEV_DOMAIN`) — не его
  ревьюер и не его владелец.
