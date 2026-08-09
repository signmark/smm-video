# Prod access, Jira API, project map

> **Это СНИМОК, а не правила.** Всё ниже — измеренное состояние проекта на 04–07.08.2026:
> адреса, идентификаторы полей, номера переходов, поведение внешних сервисов, ловушки версий.
> Такие факты устаревают молча и по своему графику — сервис меняет умолчание, поле переезжает,
> права правят в интерфейсе. **Перед тем как опереться на строку отсюда — перепроверь её**,
> особенно если она про поведение чужого сервиса.
>
> Общие правила работы лежат отдельно (`notes/rules.md`) и от этого файла не зависят.
> Разделение намеренное: если смешать, читатель примет частность вроде «page_size максимум 100»
> за закон, хотя это поведение одного сервиса в один день.
>
> Секретов здесь нет: только пути к файлам с ключами, публичный ключ и адреса. Сами ключи
> не выписывать сюда никогда — на них ссылаются приметой (правила 19 и 20).

## SSH to prod
`ssh prod` works (key added by @signmark 2026-08-04). `~/.ssh/config` → `31.128.43.113`, user `root`.
My pubkey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINXmYvi/Nl/g16geCkOK3GMFoW9lzakSF2gEO4De/H/k Clause_Dev_Hermi@Hermes`

Hermes itself is a bare worker box: toolchain only (git 2.53, node 24.16, npm 11.13, python 3.14,
docker 29.5, curl, jq). No project checkout, no Jira config, no passwordless sudo. All real work
happens over ssh on prod. No Jira Raft integration exists (`raft integration list` → only Raft Survey).

## Jira API
Creds `/root/.config/jira/env` on prod. URL `https://jira.nutrientplaner.ru`.
**Server/DC 9.x** — `Authorization: Bearer $JIRA_TOKEN` only (Basic fails), REST `/rest/api/2/`,
plain-text descriptions (NOT ADF).

```
ssh prod 'set -a; . /root/.config/jira/env; set +a; curl -sS -H "Authorization: Bearer $JIRA_TOKEN" ...'
```

- Transitions: `11`→Сделать, `21`→В работе, `31`→Готово, `41`→Протестировано
- Epic link field `customfield_10101` = `"AI-44"`; issue type in Russian `{"name":"Задача"}` (Task/Bug → 400)
- Priorities P0–P2 go in the description text, never the `priority` field
- **Attribution caveat:** we use signmark's PAT, so every agent action is authored
  "Дмитрий Жданов". He gets no notifications for it and the log can't separate agents from him.

## Jira hygiene (owner's rule — the feed is shared with humans)
- NO intermediate events: don't move to "В работе", don't edit fields, don't comment mid-work
- **One event per close:** short comment (what / commit / how verified) + transition, single visit
- Close only after deploy + prod verification; otherwise leave open explaining what's missing
- One consolidated ticket with a checklist beats a scatter of small ones
- Detail lives in repo `docs/prompts/`, not in the ticket. Jira gets a summary + link.
- Routing: tester bugs → `SM`; engineering/tech-debt/fixes → `AI` under epic AI-44. Bridge with a
  comment in the SM ticket, never a duplicate task.
- Review handoff goes *through the ticket*, and needs 5 parts: commit range; per-checklist-item
  commit + finding; what proves it (test counts + how many redden without the fix); mandatory check
  results as numbers; explicit list of what was NOT done and why.

## Prod / repo map
- Repo `/root/smm`, remote `git@github.com:signmark/smm-video.git`
- Dashboard `client/src/pages/dashboard/index.tsx`, stats `server/routes/content.ts`,
  TZ helper `client/src/lib/date-utils.ts`, cache `server/utils/content-cache.ts`
- Deploy **only** via `scripts/deploy-smm.sh` (never manual `docker compose build`); smoke `scripts/smoke.sh`
- Release gate: `origin/main = image = container = /health`. Worktrees under `/root/smm-worktrees/`
- Container `smm` ← image `root-smm:deployed`, carries label `org.opencontainers.image.revision`
- Directus container `root-directus-1`, runs uid 1000(node), health `:8055/server/health`,
  uploads bind `/root/directus_data` → `/directus/uploads`
- Commit as myself, don't mutate shared git config (global user is `Mavis`):
  `git -c user.name="Clause_Dev_Hermi" -c user.email="clause-dev-hermi@raft.local" commit`

## Date/timezone handling (client) — learned on SM-16, 2026-08-05
`client/src/lib/date-utils.ts` is the single source of truth. **Never** use raw
`format(new Date(x))` / `toLocaleDateString` — that's the recurring 3-hour drift bug
(SM-14, SM-16).
- `normalizeTimestamp(v)` — Directus returns some timestamps **without `Z`**; this appends it so
  the browser doesn't read UTC as local. Exported, also used in `pages/posts/index.tsx`.
- `formatDateWithTimezone(v, fmt)` — **already calls normalizeTimestamp internally**, then formats
  in `Europe/Moscow`. So it fixes parse *and* display in one call. (I initially claimed it didn't —
  wrong, corrected.)
- **GOTCHA that caused SM-16's second failure:** `normalizeTimestamp` begins with
  `if (value instanceof Date) return value;` — it is a **no-op on Date objects**. So if a zoneless
  string was already parsed by a bare `new Date()` upstream, passing the resulting Date through
  `formatDateWithTimezone` does NOT rescue it; the wrong instant is formatted faithfully.
  Normalisation only works on the **string**. Fix at the parse site, not the format site.
  This is why one card showed "Создано 12:15" (string → correct) and "Опубл. 09:16" (via
  `published-content.ts validDate()` → `new Date()` → 3h early).
- `toDisplayDateKey(v)` — Moscow calendar day `YYYY-MM-DD` for **grouping keys**. Using local
  `getFullYear/getMonth/getDate` instead makes late-night posts slide a day for viewers west of MSK.
- `isInDisplayWeek(v)` — Monday-start Moscow week; this is the **dashboard** notion of "this week",
  which is *not* "last 7 days" (relevant to SM-15 confusion).
- DB columns `campaign_content.{created_at,scheduled_at,published_at}` are
  `timestamp without time zone` — hence the whole class of bugs.

## npm / lockfile — learned the hard way on AI-70, 2026-08-05
**Three environments, three different npm. This caused a whole day of false conclusions.**
- Hermes (agent machines): node 24 / **npm 11.x**
- prod host: node 22.22.2 / **npm 10.9.7**
- **build image** (digest-pinned in Dockerfile): node 22.23.2 / **npm 10.9.8** ← the only one that matters

Facts established by experiment on identical files:
- A lockfile generated by **npm 11 is INVALID for npm 10** (`EUSAGE … Missing: esbuild@0.28.1,
  yaml@2.9.0` — vitest's nested vite@8 subtree). npm 11 says `EXIT=0, added 1479`.
  Since AI-42 the image builds via `npm ci`, so such a lock **breaks `docker build`** → no deploys.
- **`npm audit fix` CRASHES under npm 10.9.8** on this tree: `Cannot read properties of null
  (reading 'edgesOut')`, `--dry-run` too, writes nothing. Reproduced starting from main's own
  valid lock. Plain `npm audit` works fine.
- **npm is pinned nowhere** — `engines.npm` is `>=10.0.0`, so 11.x is legal. AI-69 pinned node
  only. Until npm is pinned (`packageManager`+corepack or `engines.npm: ~10.9`), anyone
  regenerating a lock on a newer machine reintroduces an unbuildable file.

**Verification rule:** a lockfile change is only proven by running inside the digest-pinned image:
```
docker run --rm -v <worktree>:/w -w /w node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 \
  sh -c 'npm ci && npm audit fix && rm -rf node_modules && npm ci'
```
Never in `/root/smm` itself — use a throwaway worktree so the prod checkout stays clean.

## Скрейпер аналитики (SM-15 / AI-72), выяснено 2026-08-05
Сервис `217.26.25.95:3030`, база `/api/v1`, авторизация Bearer. Документация — ANALYTICS_API.md
(прислал владелец; копия в `docs/ANALYTICS_API.md` в моём workspace).
- **Два ключа, оба у нас есть.** `SCRAPER_API_KEY` — общий, в `/root/.env` и в env контейнера.
  `SCRAPER_ANALYTICS_API_KEY` — для аналитики, лежит в **Directus, коллекция `global_api_keys`**,
  подгружается приложением при старте (`load-env-from-directus.ts`, список
  `ALWAYS_OVERRIDE_FROM_DIRECTUS`).
- **ЛОВУШКА:** аналитический ключ грузится **в процесс приложения**, поэтому в env контейнера его
  нет. `docker exec smm node -e process.env.SCRAPER_ANALYTICS_API_KEY` → **ложный отрицательный**.
  Смотреть в `global_api_keys` или в лог старта («Overriding SCRAPER_ANALYTICS_API_KEY»).
- Достать ключ: `select api_key from global_api_keys where service_name='SCRAPER_ANALYTICS_API_KEY'`.
- Полезные эндпоинты: `/monitoring/channels/{id}/parse-status` (когда парсился),
  `/monitoring/channels/{id}/force-parse`, `/channels/{id}/posts` (метрики по каждому посту).

### Контракт `/channels/{id}/posts` — замерено 05.08, три ловушки
1. **Авторизация только `Authorization: Bearer <key>`.** На `X-API-Key` → 401
   «Analytics API key не предоставлен». Ключ — `SCRAPER_ANALYTICS_API_KEY` из Directus.
2. **Параметр `limit` СЕРВИС ИГНОРИРУЕТ.** Работает `page_size` (дефолт 20, максимум 100,
   больше → 422) + `page`. Ответ: `{items,total,page,page_size,has_next_page,query}`.
   Я на этом обжёгся: первый агрегат молча обрезался 20 строками на канал и был занижен.
3. **`total` считает СНИМКИ, а не посты.** У «Ботанутого Кости» `total=460` → 73 уникальных
   поста по `url`. Дедупить по `url`, лайки брать максимумом по снимкам.
4. **`/posts/dynamics`: `min_views` по умолчанию = 100.** На мелком канале `days=7` отдаёт
   `posts_count=0` — выглядит как «скрейпер ничего не собрал». С `min_views=0` → 50 постов.
   Плюс `limit` там по умолчанию 50. **Это главный источник ложного вывода «данных нет».**
- Поля одинаковы на обеих платформах: `likes/views/comments/shares/engagement_rate/`
  `captured_at/published_date/url/text/platform_post_id/highlight/id/platform`.
  Поля `reactions` НЕТ — реакции TG приходят в `likes`.

### Ground truth: как проверять, что скрейпер не врёт
Публичный пост Telegram отдаёт метрики без авторизации:
`curl -A Mozilla/5.0 "https://t.me/<channel>/<id>?embed=1"` → в HTML
`tgme_widget_message_views` (просмотры) и `tgme_widget_message_reaction` (реакции).
**VK так проверить НЕЛЬЗЯ** — `vk.com/wall...` отдаёт форму входа, публичных метрик нет.
- **Метрики захватываются в момент парсинга** и не обновляются задним числом; refresh раз в 6 часов
  за последние 7 дней. Скрейпер хранит **несколько снимков одного поста** — отсюда
  `postRows 57 → uniquePosts 12` в нашей трассе, дедупликация у нас корректна.
- Наша трасса: `logAnalyticsTrace` пишет уровнем `warn`, порог `info` — видна в `docker logs smm`.
