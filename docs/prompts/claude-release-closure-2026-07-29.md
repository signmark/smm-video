# Release closure — 2026-07-29

**Исполнитель:** Claude (код, тесты, docs, commit, push, deploy, live-проверки)
**Ревью:** Codex, после выкатки, релиз не блокирует
**Статус:** в работе → дополняется фактами по мере выполнения

---

## Baseline

Зафиксировано до первой правки:

```
origin/main = 67002e13b  fix(security): вернуть Meta доступ к временному видео, закрытый гейтом
local main  = 67002e13b  (совпадает, fast-forward не требуется)
```

Раунд 29.07.2026 в `git log` — 11 коммитов `c3f85c069..67002e13b`:

| commit | что |
|---|---|
| `c3f85c069` | экспорт отчёта не проверял, чья это кампания |
| `121dbd1e1` | SM-10: закладки трендов (ручки не существовало) |
| `79581bb56` | чистка мёртвого кода + 1-я волна тайпчека клиента |
| `27eba1460` | типы клиента догнали ответы сервера |
| `1b4df400f` | 2-я волна тайпчека 46 → 22 |
| `7626d59ae` | 3-я волна тайпчека 22 → 17 |
| `ec5005600` | явная авторизация на `/api` вместо порядка роутеров |
| `c1d162407` | durable promo reservation state machine |
| `fe4524c93` | close remaining tenant-boundary routes |
| `d5e370817` | SM-9: время публикации по Москве |
| `67002e13b` | вернуть Meta доступ к временному видео |

**Рабочее дерево на старте (не трогать / не коммитить):** `.mimocode/` (чужой WIP),
`hermes_dashboard/`, `silentsentry_api/`, `smmniap_static/silentsentry/` — посторонние
каталоги. Untracked `CLAUDE.md` и `docs/handoff-directus-old-switch-2026-07-29.md` —
свои, их коммитим.

**Расхождение, зафиксированное в задании и подтверждённое:** корневого `CLAUDE.md`
в `origin/main` нет, хотя handoff'ы на него ссылаются. Файл лежит в рабочем дереве
untracked. Восстанавливаем в git в этом раунде.

## Инфраструктура на момент раунда

| | значение |
|---|---|
| прод | `31.128.43.113`, hostname `nazicimzxh` |
| рабочий публичный домен | `https://smm.nplanner.ru` (проверен: `/` → 200, `/health` → 200) |
| `omemo.tech` | DNS смотрит на старый сервер, для проверки деплоя **не использовать** |
| старый сервер | `45.130.212.62` — только archaeology |
| compose | `/root/docker-compose.yml`, проект `root`, сервис `smm` |
| репозиторий | `/root/smm`, он же build context |
| активная БД | `DIRECTUS_DB=directus` в `/root/.env` — данные старого прода, **не менять** |
| отставленный форк | `directus_fork_backup` — **не удалять** |

## Находки предварительного анализа

### Блокер 1+2 — trends: проверяется не тот объект

`server/api/trends-routes.ts`. Хелпер `ensureTrendsCampaignAccess` (строка 17) проверяет
доступ к `campaignId` **из тела запроса**, после чего `trendId`/`trendIds` читаются и
пишутся `useAdminToken: true` без всякой связи с проверенной кампанией.

Затронуто (подтверждено чтением кода):

| ручка | строка | привилегированная операция без границы |
|---|---|---|
| `POST /api/trends/collect-comments` | 1164 | `list campaign_trend_topics` по `trendIds`, запуск внешнего скрейпера |
| `POST /api/trends/collect-comments-single` | 1217 | то же по одному `trendId` |
| `POST /api/analyze-comments` | 1802 | чтение `post_comment`, AI-анализ |
| `GET /api/trend-comments/:trendId` | 1363 | чтение `post_comment` — **проверки нет вообще** |
| `POST /api/trend-sentiment/:trendId` | 1764 | чтение `post_comment`, AI, `update campaign_trend_topics` — **проверки нет вообще** |
| `POST /api/sources/:sourceId/analyze` | 1931 | чтение трендов источника, AI по каждому, `update` — **проверки нет вообще** |

Связь с арендатором у обеих коллекций есть: `campaign_trend_topics.campaign_id` и
`campaign_content_sources.campaign_id` (подтверждено по путям записи в этом же файле,
строки 1706 и 1731).

**План:** канонические хелперы `assertTrendBelongsToRequester` /
`assertSourceBelongsToRequester`. Источник истины — `campaign_id` **загруженной записи**,
не тело запроса. Для массива — каждый уникальный id, смешанный набор отклоняется целиком.
`foreign` / `mismatch` / `not found` → 404 без oracle; недоступный Directus → 503.
Ни одна админская операция, AI-вызов или внешний скрейпер не стартуют до успешной проверки.

### Блокер 3 — денежный баг в promo reservation

`server/services/promo-reservation.ts` + `server/routes/yookassa.ts`.

Три независимых дефекта:

1. **`reclaimDeadReservations` (promo-reservation.ts:253)** выбирает все строки
   `status=reserved` и не смотрит на `needs_reconciliation` вовсе. Бронь, намеренно
   оставленную занятой после несостоявшейся отмены платежа, реклеймер освобождает.
2. **`isSlotHolderDead` (yookassa.ts:199)**: пустой `yookassa_payment_id` + 30 минут
   = «сирота». Ровно это состояние возникает при attach failure, когда платёж в ЮКассе
   **создан**. Отличить «упали до создания платежа» от «создали, но не привязали»
   в текущей схеме нечем.
3. **`flagReservationReconciliation` (promo-reservation.ts:120)** не проверяет `res.ok`
   и пишет `log(...помечена на разбор)` после HTTP 500. Ретрая нет.

**План:**
- Новый durable-маркер `payment_attempt_at`, пишется в бронь **до** обращения к ЮКассе.
  Запись не удалась → платёж не создаём вовсе (fail-closed, бронь освобождается штатно).
  Есть маркер и нет `yookassa_payment_id` → бронь **никогда** не считается сиротой.
- `reclaimDeadReservations`: фильтр исключает `needs_reconciliation=true`; CAS-переход
  `releaseRow` в reclaim-пути тоже несёт это условие (защита от гонки).
- `flagReservationReconciliation`: проверка `res.ok`, до 3 попыток, возврат `boolean`,
  success-лог только при фактическом успехе.
- Явный `releasePromoReservation` (подтверждённая отмена) продолжает работать —
  запрет касается только автоматического timeout-reclaim.

### Блокер 4 — ложное «промокод исчерпан» на TOCTOU

`server/services/promo-reservation.ts:395-396`. После unique-конфликта состояние
перечитывается, и тут же безусловно `occupied.add(slot)`. Если победитель успел
освободить слот между конфликтом и перечитыванием, слот фактически свободен, но
искусственно помечается занятым. При `max_uses=1` второй запрос получает `exhausted`.

**План:** убрать безусловный `add`; перечитанное состояние — единственный источник
истины. Живой holder уже присутствует в перечитанном множестве, исчезнувший — нет,
и тот же slot пробуется снова. Цикл ограничен `slotAttemptBudget`.

### Блокер 5 — SM-9 исправлен не полностью

`d5e370817` перевёл **форматирование** на `Europe/Moscow`
(`client/src/lib/date-utils.ts`, `toDisplayDateKey`), но **группировка** осталась
локальной: `startOfDay`, `isSameDay`, `isToday`, `isThisWeek`, `new Date(...).getDate()`
в `client/src/components/PublicationCalendar.tsx` и
`client/src/pages/dashboard/index.tsx`.

Сценарий: 01:00 МСК 29 июля хранится как `2026-07-28T22:00Z`. В браузере с TZ=UTC
карточка показывает 01:00 МСК, календарь относит запись к 28-му, дашборд не считает
её сегодняшней.

**План:** все бизнес-группировки — по московским date keys через общий helper.
Выбранная в календаре дата — wall-date, сравнивается с `toDisplayDateKey` публикации.
Начало недели задаётся явно и одинаково.

### Остаток раунда

6. **Публичные trends callbacks** — `tg-webhook` (513), `vk-webhook` (590),
   `collect-trends-callback` (659), `tg-find-groups-webhook` (704),
   `vk-find-groups-webhook` (804), `collect-comments-callback` (1328). Все анонимны.
7. **Контракт upload-video** — клиент зовёт оба адреса вразнобой:
   `/api/beget-s3/upload-video` (`pages/video/index.tsx:192`,
   `utils/storiesVideoUtils.ts:143`, `components/stories/SimpleStoryEditor.tsx:185`)
   и `/api/beget-s3-video/upload` (`components/VideoUploader.tsx:89`,
   `components/stories/VideoStoryEditor.tsx:96`). Смонтирован только второй
   (`server/routes-beget-s3.ts:21`) — три из пяти вызовов ведут в 404.
8. **video.ts / media-exec** — строковые сборки путей вокруг ffmpeg/ffprobe.
9. **Токены соцсетей в query** — `/api/vk/groups?access_token=`
   (`SocialMediaSettings.tsx:359`, `VkSetupWizard.tsx:186`),
   `/api/youtube/channel-info?accessToken=` (`YouTubeSetupWizard.tsx:278`),
   `/api/vk/validate?access_token=` (`dashboard/index.tsx:293`),
   `discover-facebook-groups?accessToken=` (`FacebookGroupsSelector.tsx:44`).
10. **Многодоменность** — база уже есть (`server/utils/public-url.ts`,
    `APP_PUBLIC_URL=https://smm.nplanner.ru`, `APP_EXTRA_ORIGINS=https://smm.omemo.tech`,
    отдельные Traefik-роутеры `smm` / `smm-alt` / `smm-rf`). Остаток: обход резолвера
    через `REPLIT_DEV_DOMAIN` в `trends-routes.ts:463,929`, `trend-collector.ts:61`,
    `real-video-converter.ts:271`; проверить недоверие к `Host`.
11. **check:client** — 17 ошибок, CI (`.github/workflows/`) отсутствует.
12. **Неиспользуемые компоненты** — проверить с учётом lazy/динамических импортов.

## Критерии готовности

- каждый cross-tenant сценарий закрыт тестом, который краснеет без guard;
- trends callbacks требуют собственный секрет, timing-safe, fail-closed в production;
- бронь `needs_reconciliation` невозможно освободить автоматическим reclaim;
- promo TOCTOU не даёт ложного `exhausted` при `max_uses=1`;
- календарь и дашборд группируют по московской календарной границе;
- загрузка видео — один контракт, живой UI-сценарий проверен;
- media paths не собираются конкатенацией строк;
- social tokens не уходят в query;
- приложение принимает `smm.nplanner.ru` и будущий `omemo.tech` без доверия `Host`;
- `npm run check:client` = 0 ошибок;
- CI на Node 20 добавлен;
- `npx vitest run`, `npm run check`, `npm run check:client`, `npm run build` — зелёные;
- коммиты в `origin/main`, образ выкачен на `31.128.43.113`, `smm.nplanner.ru` проверен.

## Процедура тестирования

Перед каждым логическим фиксом:

1. написать regression-тест;
2. убедиться, что он краснеет **без** фикса — снятием правки точечным
   `git stash push -- <файл>`, не «на глаз» (требование `AGENTS.md`);
3. вернуть правку, тест зеленеет.

Перед каждым push — все четыре:

```bash
npx vitest run
npm run check
npm run check:client
npm run build
```

На Linux-прод-хосте все четыре обязаны быть зелёными. Windows-only ошибки
`media-exec` оправданием здесь не являются — их чиним (пункт 8).

## Процедура деплоя

```bash
cd /root/smm
git fetch origin
git merge --ff-only origin/main
git status --short          # убедиться, что чужой WIP не уедет в образ
docker compose -f /root/docker-compose.yml build smm
docker compose -f /root/docker-compose.yml up -d smm
```

Docker собирает из **рабочего дерева**, а не из HEAD — поэтому `git status --short`
здесь не формальность.

Проверки после выкатки:

- контейнер поднялся, нет restart loop;
- Directus health зелёный;
- `https://smm.nplanner.ru/` → 200;
- protected `/api` без сессии → 401;
- video-temp GET/HEAD по реальному UUID доступен без сессии, POST закрыт;
- trends callbacks без секрета закрыты;
- smoke публикации/загрузки не даёт 404/401 из-за нового auth;
- ASCII-маркер нового кода найден в собранном бандле (кириллицу грепать бесполезно:
  esbuild экранирует не-ASCII в `\uXXXX`);
- логи без ошибок и утечек токенов.

`omemo.tech` для post-deploy проверки **не использовать**, пока DNS смотрит на старый
сервер.

## Откат

```bash
cd /root/smm
git revert --no-edit <commit>          # или git revert <первый>..<последний>
docker compose -f /root/docker-compose.yml build smm
docker compose -f /root/docker-compose.yml up -d smm
```

Полный `docker compose down` не использовать: он останавливает всю инфраструктуру
хоста (traefik, postgres, directus, n8n и посторонние проекты).

Откат данных не требуется: раунд не содержит миграций и разрушающих операций с БД.
Новое поле `payment_attempt_at` в `promo_reservations` добавляется как nullable —
старый код его просто игнорирует, поэтому revert приложения безопасен.

---

## Факт выполнения

*Раздел дополняется по мере работы: коммиты, результаты тестов, live-проверки.*
