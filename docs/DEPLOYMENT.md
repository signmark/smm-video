# Деплой SMM Manager в production

**Статус:** канон. Это единственный действующий путь деплоя.
**Обновлено:** 2026-07-26.

Если какой-то скрипт, README или скилл описывает другой способ поднять прод — он устарел.
Всё, что раньше лежало в `deploy/`, переехало в `_archive/deploy/` (см. [`_archive/deploy/README.md`](../_archive/deploy/README.md)).

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

Единственный источник переменных для прода — **`/root/.env`**. Он подключается в
`/root/docker-compose.yml` через `env_file: .env` (путь относительный, разрешается от каталога
compose-файла, то есть от `/root`).

**Файла `/root/smm/.env` быть не должно.** Это не случайность и не недосмотр:

- в образе его нет — `.env` исключён в [`.dockerignore`](../.dockerignore);
- на хосте он опасен: [`server/load-env.ts`](../server/load-env.ts) вызывает
  `dotenv.config({ override: true })` относительно `process.cwd()`, поэтому при запуске
  сервера из `/root/smm` такой файл **молча пересилит** переменные, пришедшие из окружения.

Если `/root/smm/.env` появился — его создали по ошибке. Удалить. `load-env.ts` теперь
ругается в лог, когда `.env` реально перекрыл уже заданные переменные при
`NODE_ENV=production`.

Шаблон переменных приложения — [`.env.sample`](../.env.sample). Инфраструктурные переменные
(`POSTGRES_PASSWORD`, `SSL_EMAIL`, `DIRECTUS_*`, `N8N_*`) живут только в `/root/.env` и в
`.env.sample` не дублируются.

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
