# Деплой SMM Manager в production

**Статус:** канон. Это единственный действующий путь деплоя.
**Обновлено:** 2026-07-29.

Если какой-то скрипт, README или скилл описывает другой способ поднять прод — он устарел.
Прежние `deploy/`, `scripts/deploy/` и `docs/deployment/FULL_DEPLOYMENT_GUIDE.md` переехали
в `_archive/deploy/` — разбор в [`_archive/deploy/README.md`](../_archive/deploy/README.md).

---

## Коротко

| Что | Где |
|---|---|
| Compose-файл | `/root/docker-compose.yml` (**вне репозитория**) |
| Compose-проект | `root` |
| Сервис | `smm` |
| Build context | `./smm` → `/root/smm` (корень репозитория) |
| Dockerfile | `/root/smm/Dockerfile` (корневой, **не** из `deploy/`) |
| Образ | `root-smm` |
| Имя контейнера | `smm` |
| Окружение | **только** `/root/.env` через `env_file: .env` |
| Наружу | traefik → `https://smm.nplanner.ru` (порт 5000 внутри) |
| Прод-хост | `31.128.43.113`, hostname `nazicimzxh` |

Проверить, что это действительно так, можно на живом контейнере:

```bash
docker inspect smm --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

Ожидаемый вывод — `/root/docker-compose.yml`.

## Окружение

Файлового источника ровно один — **`/root/.env`**, он подключается в
`/root/docker-compose.yml` через `env_file: .env` (путь относительный, разрешается от каталога
compose-файла, то есть от `/root`). Но переменные в работающем контейнере складываются из
**трёх** источников, в порядке применения:

| # | Источник | Что даёт |
|---|---|---|
| 1 | `env_file: .env` → `/root/.env` | инфраструктура и большинство ключей (44 переменные) |
| 2 | `environment:` в compose | `NODE_ENV`, `PORT=5000`, `DIRECTUS_URL=http://directus:8055`, `VIDEO_APP_HOST` — перекрывают `.env` |
| 3 | Directus, коллекция `global_api_keys` | подгружается на старте, [`server/services/load-env-from-directus.ts`](../server/services/load-env-from-directus.ts) |

Третий источник легко упустить. При старте сервер тянет из Directus 16 ключей —
`BEGET_S3_ACCESS_KEY/SECRET_KEY/BUCKET`, `GEMINI_API_KEY`, `VERTEX_AI_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `N8N_*`-вебхуки, `SCRAPER_ANALYTICS_API_KEY` и др. Обычно они
проставляются только если в env пусто, но три из них —
**`GEMINI_API_KEY`, `GEMINI_PROXY_URL`, `SCRAPER_ANALYTICS_API_KEY` — перекрывают env всегда**
(список `ALWAYS_OVERRIDE_FROM_DIRECTUS`).

Практический вывод: **если такого ключа нет в `/root/.env` — это не поломка.** Он, скорее
всего, лежит в Directus. Правка `/root/.env` для этих трёх ключей вообще ни на что не влияет —
менять надо в Directus. Загрузка не блокирующая: таймаут 12 с, при ошибке сервис стартует на
том, что есть в env, с warn'ом `[load-env-directus]` в логе.

### Почему `/root/smm/.env` быть не должно

- в образе его нет — `.env` исключён в [`.dockerignore`](../.dockerignore);
- на хосте он опасен: [`server/load-env.ts`](../server/load-env.ts) вызывает
  `dotenv.config({ override: true })` относительно `process.cwd()`, поэтому при запуске
  сервера из `/root/smm` такой файл **молча пересилит** переменные, пришедшие из окружения.

Если файл появился — его создали по ошибке. Удалить. `load-env.ts` теперь пишет warn, когда
`.env` реально перекрыл уже заданные переменные при `NODE_ENV=production`.

### Про шаблоны

Полноценного шаблона переменных приложения в репозитории **нет**. Корневой
[`.env.sample`](../.env.sample) на эту роль не годится: это чужой инфраструктурный шаблон
(Budibase, MinIO, CouchDB, Appsmith), оставшийся от какого-то self-hosting-набора, и ни одной
переменной SMM в нём не перечислено. Не ориентироваться на него.
Фактический список — `grep -rhoE "process\.env\.[A-Z][A-Z0-9_]+" server/ shared/` (110 штук)
плюс `KEYS_TO_LOAD` в `load-env-from-directus.ts`.

## Пересборка и раскатка

> **СТАТУС НА 2026-07-31: скрипт ещё не включён.**
>
> `scripts/deploy-smm.sh` лежит в репозитории, но пока НЕ работает: он требует,
> чтобы в `/root/docker-compose.yml` у сервиса `smm` не было секции `build:`, а
> она там ещё есть. Скрипт сознательно падает на этой проверке, а не
> «предупреждает и продолжает».
>
> Переключение ждёт решения владельца: удаление `build:` намеренно ломает
> `docker compose build smm`, то есть привычную команду Claude Desktop, и
> сделать это можно только синхронно со всеми исполнителями (AI-50).
>
> **До переключения действующая процедура — прежняя, но обязательно из чистого
> worktree:**
>
> ```bash
> cd /root/smm && git fetch origin --prune
> git worktree add --detach /root/smm-build-<метка> origin/main
> docker build -t root-smm -f /root/smm-build-<метка>/Dockerfile /root/smm-build-<метка>
> docker compose -f /root/docker-compose.yml up -d --no-build --no-deps --force-recreate smm
> git worktree remove --force /root/smm-build-<метка>
> ```
>
> `--no-build` обязателен: без него compose пересоберёт образ из `/root/smm`, где
> лежит чужой незакоммиченный WIP. Перед сборкой убедиться, что чужой сборки не
> идёт: `ps aux | grep "[d]ocker build"`.
>
> Всё, что описано ниже, вступает в силу после переключения.


**Единственная команда деплоя:**

```bash
/root/smm/scripts/deploy-smm.sh
```

Она выкатывает текущий `origin/main` целиком: fetch → чистый worktree ровно на
SHA → сборка → повторная сверка `origin/main` → переключение алиаса →
`up -d --no-build` → проверка. Всё это под host-wide локом.

`docker compose build smm` больше не канон и с 2026-07-31 физически невозможен:
у сервиса `smm` в `/root/docker-compose.yml` нет секции `build:`, только
`image: root-smm:deployed`. Скрипт это проверяет до любых действий и падает,
если кто-то вернул `build:` обратно.

### Почему так, а не пара команд руками (AI-50)

На хосте одновременно работают несколько исполнителей — агенты Raft, Claude
Desktop, человек. Общий ресурс ровно один: тег образа и контейнер `smm`.
Правки при этом могут вообще не пересекаться — ломается не содержимое, а
порядок: кто собрал и переключил последним, того версия остаётся на проде.

31.07.2026 две сборки шли параллельно. Обошлось только потому, что вторая
успела подтянуть актуальный `main`. Собери она на 20 минут раньше — уже влитый
security-фикс молча исчез бы с прода, и заметить это можно было бы лишь грепом
по бандлу.

Отсюда три инварианта скрипта:

1. **Очередь.** `flock` держится от fetch до проверки прода. Второй деплой ждёт
   и сообщает об этом, но не строит параллельно.
2. **Устаревшая сборка не выкатывается.** После сборки `origin/main`
   перечитывается; если он уехал — контейнер не переключается, скрипт выходит с
   кодом **75** («повтори»), образ остаётся для диагностики.
3. **Контекст сборки — временный worktree на SHA, никогда `/root/smm`.** Docker
   берёт контекст из рабочего дерева, а не из HEAD: сборка из общего каталога
   унесёт в прод чужие незакоммиченные файлы.

### Откат

```bash
/root/smm/scripts/deploy-smm.sh --rollback <sha>
```

Откат идёт под тем же локом и только на ранее собранный образ. Обычный деплой
принимает исключительно свежий `origin/main` — вернуться на старый SHA «просто
деплоем» нельзя, это отдельный осознанный флаг.

Посмотреть, что можно откатить:

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^root-smm:'
```

### Что выкачено прямо сейчас

```bash
curl -s https://smm.nplanner.ru/health | jq -r .revision
```

Поле `revision` — SHA, из которого собран образ. Он же висит меткой
`org.opencontainers.image.revision` на образе и на контейнере; скрипт после
выкатки сверяет все три и откатывается при расхождении. Грепать ASCII-маркеры
по бандлу больше не нужно — это был обходной путь, пока provenance не было.

### Проверить вручную, что три источника сходятся

```bash
docker image inspect root-smm:deployed --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
docker inspect smm --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
curl -s https://smm.nplanner.ru/health | jq -r .revision
```

### Быстрая выкладка фронта — ЗАПРЕЩЕНА

Раньше здесь стоял «быстрый путь»: собрать `dist` на хосте и подложить его в
контейнер через `docker cp`. Он удалён и использоваться не должен.

Причина: после него контейнер содержит код, которого нет ни в одном образе, а
`/health.revision` продолжает показывать SHA прежней сборки. То есть ровно тот
класс расхождения, ради закрытия которого заведён provenance — только созданный
своими руками. Следующий деплой такие правки молча затрёт.

Нужен быстрый выкат клиентской правки — коммит, push, `deploy-smm.sh`.

### Правила

- **Всегда указывать `-f /root/docker-compose.yml`.** Без `-f` compose возьмёт файл из текущего
  каталога и, если он там окажется, поднимет параллельный стек с теми же `container_name` и
  портами 80/443 — прод при этом ляжет.
- **Всегда указывать сервис `smm`.** `up -d` без имени сервиса тронет весь стек `root`
  (traefik, postgres, directus, n8n, video-app, smmniap).
- `docker compose ... down` на этом файле останавливает **всю** инфраструктуру хоста. Для
  выкладки приложения он не нужен: `build` + `up -d smm` пересоздаёт контейнер сам.
- Не запускать `docker system prune` в рамках деплоя.

## Домены и переезд

| | значение |
|---|---|
| канонический (primary) | `https://smm.nplanner.ru` — `APP_PUBLIC_URL` в `/root/.env` |
| допустимый (allowlist) | `https://smm.omemo.tech` — `APP_EXTRA_ORIGINS` |
| третий алиас | `smm.roboflow.space` — `SMM_HOST_ALT2` |

Разделение принципиальное. **Primary** — адрес, который приложение САМО
подставляет в письма, OAuth `redirect_uri`, `return_url` платежей и ссылки на
временные медиа. **Allowlist** — адреса, на которых нас допустимо открыть и чей
`Host` можно принять.

Заголовок `Host` источником правды не является: он принимается только при
ТОЧНОМ совпадении с одним из своих доменов
([`server/utils/public-url.ts`](../server/utils/public-url.ts),
`resolveRequestOrigin`). Иначе подделанный `Host` подставил бы чужой домен в
OAuth-поток и в ссылки, уходящие наружу.

В Traefik домены заданы **тремя отдельными роутерами** (`smm`, `smm-alt`,
`smm-rf`), а не одним правилом с `||`. Это не стилистика: Traefik заказывает
ОДИН SAN-сертификат на все домены роутера, и провал валидации любого из них
оставляет без сертификата все остальные. Пока у `smm.omemo.tech` DNS смотрит на
другой сервер, его ACME-заказ обязан быть отдельным — иначе он утащит за собой
рабочий `smm.nplanner.ru`.

### Переключение DNS omemo.tech (будущий cutover)

Код к переезду готов: менять его не потребуется, только переменные.

1. Проверить, что `omemo.tech` уже в `APP_EXTRA_ORIGINS` (сейчас там
   `smm.omemo.tech`; добавить `https://omemo.tech`, если переезжает и апекс).
2. Переключить DNS A-записи на `31.128.43.113`, дождаться распространения.
3. Дождаться, пока Traefik закажет сертификат для `smm-alt` — до этого шага
   ACME-заказ будет падать, и это нормально, он изолирован своим роутером.
4. Поменять местами primary и alias в `/root/.env`:
   `APP_PUBLIC_URL=https://smm.omemo.tech`,
   `APP_EXTRA_ORIGINS=https://smm.nplanner.ru`.
5. Перезапустить ТОЛЬКО сервис `smm`:
   `docker compose -f /root/docker-compose.yml up -d smm`.
6. Проверить оба домена: `/` → 200, protected `/api` без сессии → 401.
7. Обновить `redirect_uri` в кабинетах OAuth-провайдеров (VK, YouTube,
   Instagram/Threads) — они сверяют его точным совпадением.

**Rollback cutover:** вернуть прежние значения `APP_PUBLIC_URL` /
`APP_EXTRA_ORIGINS` в `/root/.env` и поднять `smm` заново. Кода это не
касается, пересборка образа не нужна. DNS при этом можно не откатывать:
`smm.nplanner.ru` остаётся в allowlist и продолжает работать.

**Не проверять `omemo.tech` на новом сервере до переключения DNS** — запрос
уйдёт на старый сервер, и ответ 200 оттуда не означает ничего про эту
инсталляцию.

## Проверка после деплоя

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "^smm"
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://smm.nplanner.ru/health
```

Опционально — убедиться, что в собранный бандл попал нужный фикс:

```bash
docker exec smm grep -c "YOUR_FIX_PATTERN" /app/dist/server/index.js
```

Дальше — smoke владельцем в браузере.

## Что рядом в том же compose-проекте

`/root/docker-compose.yml` держит не только `smm`: там traefik, postgres, pgadmin, directus,
n8n, `video-app` (`video.omemo.tech`), `videoapp` (`video-app.omemo.tech`) и `smmniap`
(статика на `omemo.tech`). Всё это — один проект `root`, поэтому неаккуратная команда без имени
сервиса задевает соседей.

## Кто деплоит

Production-деплой — зона Claude: он же пишет код, гоняет проверки, пушит в
`origin/main` и выкатывает. Разрешение на каждый штатный деплой не запрашивается
(владелец, 2026-07-26: «код ты пишешь ты и деплоишь»). Ревью Codex идёт после
выкатки и релиз не блокирует; откат — `git revert` + пересборка.

Прежняя редакция этого раздела называла зоной деплоя Mimo и требовала его
вторым ревьюером на изменения в Docker/CI. Такого состава нет — см. «Урок v4»
в [`AGENTS.md`](../AGENTS.md).
