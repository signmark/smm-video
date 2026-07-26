# Деплой SMM Manager в production

**Статус:** канон. Это единственный действующий путь деплоя.
**Обновлено:** 2026-07-26.

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
| Наружу | traefik → `https://smm.omemo.tech` (порт 5000 внутри) |

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

Из любого каталога, всегда с явным `-f`:

```bash
docker compose -f /root/docker-compose.yml build smm
```

```bash
docker compose -f /root/docker-compose.yml up -d smm
```

Если менялись `package.json` / зависимости / появились новые экспорты — сборка без кеша:

```bash
docker compose -f /root/docker-compose.yml build --no-cache smm
```

Логи:

```bash
docker compose -f /root/docker-compose.yml logs -f --tail 100 smm
```

Рестарт без пересборки:

```bash
docker compose -f /root/docker-compose.yml restart smm
```

### Быстрая выкладка фронта (только `client/`)

Если менялся исключительно клиентский код, полная пересборка образа (3–5 мин) не нужна —
можно собрать на хосте и подложить `dist` в контейнер (~10 сек):

```bash
cd /root/smm && git pull && npm run build && docker cp ./dist smm:/app/ && docker restart smm
```

Это допустимо только для `client/`. Любое изменение в `server/`, `Dockerfile`,
`package.json` или конфиге esbuild требует обычной пересборки — иначе образ и контейнер
разъедутся. Правка так и остаётся временной: контейнер её переживёт, а следующий
`build` возьмёт код из git (что нормально — он уже закоммичен).

### Правила

- **Всегда указывать `-f /root/docker-compose.yml`.** Без `-f` compose возьмёт файл из текущего
  каталога и, если он там окажется, поднимет параллельный стек с теми же `container_name` и
  портами 80/443 — прод при этом ляжет.
- **Всегда указывать сервис `smm`.** `up -d` без имени сервиса тронет весь стек `root`
  (traefik, postgres, directus, n8n, video-app, smmniap).
- `docker compose ... down` на этом файле останавливает **всю** инфраструктуру хоста. Для
  выкладки приложения он не нужен: `build` + `up -d smm` пересоздаёт контейнер сам.
- Не запускать `docker system prune` в рамках деплоя.

## Проверка после деплоя

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "^smm"
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://smm.omemo.tech/health
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

По [`AGENTS.md`](../AGENTS.md) production-деплой — зона Mimo, скилл
[`.mimocode/skills/commit-and-rebuild`](../.mimocode/skills/commit-and-rebuild/SKILL.md).
Изменения в Docker / CI / deploy-скриптах требуют Mimo вторым ревьюером.
