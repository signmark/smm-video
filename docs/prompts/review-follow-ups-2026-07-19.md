# Review follow-ups — 2026-07-19 (Claude, ревью коммитов 490dc28…299becb)

Незакрытые находки из ревью последних коммитов. Каждая секция — самостоятельная
задача: контекст, что сделать, критерии приёмки. Приоритет по убыванию.
Перед началом любой задачи: `npx vitest run <затронутые тест-файлы>` должен быть
зелёным до и после.

---

## Task 1 — ✅ ЗАКРЫТ (2026-07-19, Kimi, закоммичено в d680977)

Сделано ровно по спецификации: `<pre>`/`<code>` изолируются в плейсхолдеры
(`\x00CB<n>\x00`) сразу после `decodeHtmlEntities` и возвращаются последним
шагом с однократным экранированием `& < >` — `escapeTextOutsideTags` и
`cleanupWhitespace` их содержимое больше не видят. Заодно: hex-сущности
`&#x…;` декодируются (с защитой диапазона и отсевом суррогатов D800–DFFF,
добавленным и в десятичную ветку), хвостовой `\n` внутри `<pre>` уходит
через `.trim()` при подстановке.

Проверки: `<pre>&lt;div&gt;hi&lt;/div&gt;</pre>` → дословно; `<code>if (a &lt; b)</code>`
→ сохраняет `&lt;`; `&#x27;` → `'`; markdown внутри `<code>` не конвертируется;
незакрытый `<pre>` закрывается. Тесты: 31 в `telegram-html.test.ts` (+11 новых),
`telegram-service.test.ts` 13, `telegram-legacy-format.test.ts` 2 — всё зелёное,
`tsc -p tsconfig.critical.json` чисто. Коммит: см. `git log -1`.

Дополнительно: из исходного файла убраны два литеральных NUL-байта (U+0000)
в примере плейсхолдера — из-за них файл не читался рядом инструментов;
заменены на текст `\x00`.

---

## Task 2 — ✅ ЗАКРЫТ (2026-07-20, Codex, закоммичено Mavis: 13b99fc)

Scheduler теперь пишет канонический статус `partially_published`.
Оба storage-фильтра и дополнительная JS-фильтрация читают как канонический
статус, так и легаси `partial`; миграция данных не выполнялась. Добавлены
сфокусированные тесты write-path и Directus-фильтра. TypeScript и тесты
Task B зелёные; преждесуществующие падения полного suite не изменены задачей.

**Проблема:** по кодовой базе живут два синонимичных статуса частичной
публикации, и выборки их видят по-разному:

- Пишут `'partially_published'`: `server/api/social-publishing-router.ts`
  (через `getContentPublicationStatus`), `server/api/clips-publishing-router.ts:168`.
- Пишет `'partial'`: `server/services/publish-scheduler.ts:733-735`.
- Читают оба: `publish-scheduler.ts:254` (`_in: ['scheduled','partial','pending','partially_published']`),
  `server/services/analytics-service.ts:20`, клиентский
  `client/src/lib/published-content.ts` (`PUBLISHED_CONTENT_STATUSES`).
- Читают ТОЛЬКО `'partial'` (теряют partially_published-контент):
  `server/storage.ts:1285` и
  `server/services/directus-storage-adapter.ts:286` — обе выборки
  «запланированных публикаций».

**Что сделать:** привести к одному канону — `'partially_published'` (его
возвращает shared `getContentPublicationStatus`, менять shared-контракт не надо):
1. `publish-scheduler.ts:733-735` — писать `'partially_published'` вместо `'partial'`.
2. `storage.ts:1285` и `directus-storage-adapter.ts:286` — расширить фильтры до
   `['scheduled', 'partial', 'partially_published']` (`'partial'` оставить для
   легаси-записей в БД, которые уже лежат с этим статусом).
3. Места чтения, где перечислены оба, не трогать — они и так совместимы.
4. НЕ делать массовую миграцию данных в Directus в рамках этой задачи.

**Приёмка:**
- `git grep -n "'partial'" server/ | grep -v __tests__` — не осталось мест,
  которые *пишут* `'partial'` (чтение в `_in`-фильтрах — допустимо).
- Существующие тесты `publish-scheduler*`, `schedule-time.test.ts` проходят;
  на пункт 1 добавить/поправить юнит-тест.

---

## Task 3 — ✅ ЗАКРЫТ (проверено 2026-07-19, действий не требуется)

Проверка выполнена: оба сервиса персистят полный набор полей
(`youtube-video-service.ts:270-281`, `youtube-shorts-service.ts:207-218`):
`postId: videoId`, `postUrl: videoUrl`, `publishedAt`, `status: 'published'`.
`isConfirmedPublishedPlatform` проходит. Ничего не делать, задачу никому
не выдавать. Исходная формулировка ниже — для истории.

## ~~Task 3 (small, проверка): YouTube-сервисы должны персистить postId~~

**Контекст:** в `/publish/now` (`server/api/social-publishing-router.ts`)
итоговый статус контента вычисляется по свежему `social_platforms` через
`isConfirmedPublishedPlatform` (`shared/schedule-time.ts:26`) — платформа
считается опубликованной только при наличии `publishedAt` ИЛИ `postId` ИЛИ
`postUrl`. Все роутерные обработчики (telegram/vk/facebook/threads/instagram)
пишут `postId` сами, а YouTube персистит состояние внутри
`youtubeVideoService.publishVideo` / `youtubeShortsService.publishShort`.

**Что сделать:** проверить, что оба YouTube-сервиса при успехе записывают в
`social_platforms.youtube` как минимум `status: 'published'` и
`videoId`→`postId` (или `videoUrl`→`postUrl`) c `publishedAt`. Если нет —
дописать. Иначе успешная публикация только в YouTube даст
`getContentPublicationStatus` → `'scheduled'`, и контент застрянет
«запланированным».

**Приёмка:** юнит-тест: после успешного `publishVideo`/`publishShort` запись
платформы проходит `isConfirmedPublishedPlatform`.

---

## Task 4 (small): тесты ходят в реальную сеть

**Проблема:** при прогоне `server/__tests__/autonomous-ai-tools.test.ts`
реально вызывается Gemini (генерация изображения) и выполняется загрузка в
боевой Beget S3 (в логах — реальный URL бакета). Это деньги, флак с
5-секундными таймаутами и мусор в бакете.

**Что сделать:** замокать в этом тест-файле HTTP-клиенты/сервисы
(`gemini`-генерация, `beget-s3-storage`) так, чтобы ни один тест не делал
внешних запросов. Проверить остальные упавшие файлы на то же самое
(`api_routes_new.test.ts` — 5 тестов с таймаутом ровно ~5s, признак реального
запроса).

**Приёмка:** `npx vitest run server/__tests__/autonomous-ai-tools.test.ts
server/__tests__/api_routes_new.test.ts` проходит < 5 секунд без сети
(можно проверить, отключив сеть или подсунув фиктивные env-URL).

---

## Task 5 (chore): хронически падающие тесты маскируют регрессии

**Состояние на 299becb:** полный `npx vitest run` — 17 падений в 9 файлах,
все преждесуществующие (проверено прогоном на родительском коммите 0d117a5):
`environment-detector` (1), `logger` (1), `health` (2), `youtube-service` (2,
n8n), `ai-assistant-service` (2), `publish-scheduler-routing` (1, флак — на
baseline падало 5), `telegram-collect-comments` (1), `autonomous-ai-tools` (2,
сеть — см. Task 4), `api_routes_new` (5, сеть).

**Что сделать:** разобрать по одному: починить, замокать окружение или пометить
`it.skip` с TODO и причиной. Цель — зелёный полный прогон, чтобы «тесты прошли»
снова что-то значило.

**Приёмка:** `npx vitest run` — 0 failed.

---

## Мелочи — ✅ ЗАКРЫТЫ (2026-07-20, Kimi, закоммичено Mavis: 9e230e3)

Сверх ТЗ: zero-width / BOM зачистка переехала в shared-утилиту
`toTelegramHtml` (правильное место), а не осталась в `telegram-service.ts`
(где предлагал промпт). Тег-баланс диагностика убрана как шум.

- `server/services/social/telegram-service.ts` (`formatTextForTelegram`):
  дублирующие зачистки после `toTelegramHtml` (newline collapse,
  zero-width / BOM) убраны — утилита уже это делает.
  Там же: диагностический подсчёт открывающих/закрывающих тегов
  убран как чистый шум (балансировка гарантирована `balanceTags`).
- `server/services/social/telegram-service.ts` (`safeFormatForTelegram`):
  plain-text-фолбэк теперь экранирует `&`/`<`/`>` — деградированное
  сообщение не отскочит от `parse_mode=HTML`.
- `server/utils/telegram-html.ts` (`dropEmptyTags`): пустые
  `<a href="…"></a>` теперь вычищаются (паттерн расширен).
- `server/utils/telegram-html.ts` (`cleanupWhitespace`): zero-width /
  BOM зачистка перенесена сюда как часть общего pipeline.

Тесты: telegram-html 31/31, telegram-service 13/13,
telegram-legacy-format 2/2 — 50/50 зелёные.

## Зафиксированные трейд-оффы (НЕ чинить, оставлено осознанно)

- `toTelegramHtml`: decode-first означает, что намеренно экранированный автором
  текст `&lt;p&gt;` трактуется как разметка. Принято: экранированный HTML
  приходит из редактора и является разметкой.
- `analytics-service.ts` (`supplementFromScraper`): нулевые агрегаты скрейпера
  пропускаются целиком — канал с подлинно нулевой вовлечённостью за период не
  обнулит устаревшие сохранённые метрики. Принято как меньшее зло.
- `/publish/now`: при `partially_published` контент-level `published_at`
  намеренно пишется как `null` (контракт shared/schedule-time.ts:116), карточка
  берёт время из per-platform фолбэка `getPublishedDisplayDate`.
- `telegram-service.ts`: обрезка до 4096 (`formatTextForTelegram`) и 4000
  (`prepareTelegramText`) может разрезать парный тег посередине — Telegram
  ответит ошибкой, сработает внешний retry без HTML. Tag-aware truncate —
  отдельная задача, если понадобится (замечено Kimi при cleanup Task A).
