# _archive/deploy — архив параллельных путей деплоя

Архивировано 2026-07-26. **Ничего отсюда не запускать.**
Действующий путь деплоя — [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

Сюда сведены три независимых набора, каждый из которых описывал свой способ поднять прод:

| Откуда | Что |
|---|---|
| `deploy/` | стек-скрипты и четыре варианта `docker-compose*.yml` |
| `scripts/deploy/` → [`scripts-deploy/`](scripts-deploy/) | «автоматизированный деплой» времён Replit |
| `docs/deployment/FULL_DEPLOYMENT_GUIDE.md` | руководство под этот самый скрипт |

## Почему всё целиком

Всё это пришло одним коммитом `63181cd5` («Initial commit», 2026-05-18 — импорт из
Replit) и с тех пор не менялось ни разу. Ни один файл не участвует в текущем деплое:

- прод — compose-проект `root`, файл `/root/docker-compose.yml`, образ `root-smm`;
- build context прод-сервиса — `./smm` с **корневым** `Dockerfile`, а не с чем-либо из `deploy/`;
- окружение — `/root/.env` через `env_file`, а не локальный `.env`.

Ссылок на каталог из кода, `package.json` и CI нет (CI в проекте отсутствует) — только
упоминания в docs, которые поправлены отдельно.

## Что именно было опасно

Все эти скрипты — полурабочие, а не сломанные: `docker-compose` на хосте не мёртвый v1,
а шим на Compose v5, так что команды бы отработали. С архивированных скриптов снят бит
запуска (`chmod -x`), но `bash <файл>` это не остановит — поэтому они здесь, а не там.

### `scripts-deploy/deploy.sh` — худший файл в наборе

Запущенный из `/root` (а именно так его и предписывал запускать
`FULL_DEPLOYMENT_GUIDE.md`, шаг 4.2) он:

1. строка 23: `docker system prune -a -f` — сносит **все** неиспользуемые образы, а не
   только висячие;
2. строка 42: `cp ./fixed-docker-compose.yml ../docker-compose.yml` — **перезаписывает
   `/root/docker-compose.yml`** вариантом, где `smm` крутится в `NODE_ENV=development`
   через `npm run dev` с bind-mount `./smm:/app`;
3. строка 50: `cp ./env.example ../.env` — **перезаписывает `/root/.env`** шаблоном
   с плейсхолдерами;
4. строка 76: `docker-compose -f docker-compose.yml up -d --build` — поднимает весь стек
   с уже подменённого файла;
5. строки 98–117: `npm install @aws-sdk/*` **внутрь работающего контейнера** и рестарт —
   изменение, которое не переживает пересборку и расходится с образом.

Шаги 2 и 3 сегодня не срабатывают только потому, что `fixed-docker-compose.yml` и
`env.example` в корне репозитория отсутствуют (первый лежал в `deploy/`). Шаги 1, 4 и 5
сработают.

`copy_to_parent_deploy.sh` — тот же скрипт под другим именем, его же и предлагалось
скопировать в `/root/deploy.sh`. `cp-env-example.sh` — отдельная обёртка над теми же
двумя перезаписями. `install-aws-sdk.sh` — `npm install` фиксированных версий AWS SDK.

### `start.sh`

1. строки 106–117: `docker stop` **всего**, что публикует порты 80 и 443 — то есть
   прод-traefik;
2. строка 147: `docker-compose up -d --build` без `-f`, на `deploy/docker-compose.yml`.
   `container_name` там те же, что у прода (`traefik`, `postgres`, `smm`, `directus`,
   `nginx`, `n8n`), плюс те же порты 80/443. Итог: прод-traefik остановлен, а новый стек
   не поднимается — конфликт имён с контейнерами проекта `root`.

Про строки 29–38 (`cp ../.env .env`) — уточнение к первоначальной постановке задачи:
скрипт на строке 10 делает `cd "$SCRIPT_DIR"`, поэтому целью копирования был
`deploy/.env`, а источником — `/root/smm/.env`. То есть `/root/smm/.env` он не создавал,
а наоборот требовал; сегодня без этого файла скрипт падает на строке 35 ещё до всего
остального. Опасность в другую сторону: сам паттерн «положить копию `/root/.env` внутрь
репозитория» — то, чего в этом дереве быть не должно (см. `server/load-env.ts` и
`docs/DEPLOYMENT.md`).

### Остальное

**`redeploy.sh`** — `docker-compose down` + `docker system prune -f` + `chmod 666 /var/run/docker.sock`.

**`stop.sh` / `status.sh` / `logs.sh`** — `docker-compose` без `-f` на том же файле.

## Разбор по файлам

| Файл | Что это было |
|---|---|
| `docker-compose.yml` | Полный параллельный стек (traefik+postgres+pgadmin+directus+smm+nginx+n8n), домены `*.omemo.tech`, те же `container_name` и порты 80/443, что у прода. Build context `..` + `deploy/smm/Dockerfile`. |
| `fixed-docker-compose.yml` | Итерация того же: traefik v3.3, smm в `NODE_ENV=development` с `npm run dev` и bind-mount `./smm:/app`. |
| `updated-docker-compose.yml` | Ещё одна итерация той же ветки. |
| `fixed-smm-docker-compose.yml` | Огрызок только с сервисом `smm`, тоже dev-режим, именованный том под `node_modules`. |
| `docker-compose-smmniap.yml` | Вариант под раскатку статики `smmniap`. |
| `smm/docker-compose.yml` + `smm/Dockerfile` | Вложенный третий вариант, домены `*.nplanner.ru`, `env_file: ../../.env`. |
| `Dockerfile`, `Dockerfile.new` | Предшественники корневого `Dockerfile`. |
| `Dockerfile.aws`, `Dockerfile.local-aws-sdk`, `check-aws-sdk-in-docker.sh`, `copy-aws-sdk-modules.sh` | Обход проблемы с AWS SDK через `custom_modules/@aws-sdk` — давно неактуально. |
| `Dockerfile-n8n`, `n8n-custom-nodes/`, `n8n-custom-scripts/` | Кастомная сборка n8n. Прод берёт готовый `n8nio/n8n:latest`. |
| `nginx.conf` | Конфиг для сервиса `nginx` из `deploy/docker-compose.yml`. Прод раздаёт статику сервисом `smmniap` на стоковом `nginx:alpine`. |
| `setup/setup_infrastructure*.sh` | Одноразовый bootstrap сервера. |
| `diagnose-404.sh` | Диагностика, но с допущением, что compose лежит рядом со скриптом. |
| `README-smmniap-deployment.md` | Описание этого самого устаревшего пути. |
| `.env.example` | Шаблон под `deploy/`-стек. Инфраструктурные переменные теперь только в `/root/.env`, переменные приложения — в корневом `.env.sample`. |
| `scripts-deploy/*` | Бывший `scripts/deploy/` — разобран выше. |
| `FULL_DEPLOYMENT_GUIDE.md` | Бывший `docs/deployment/FULL_DEPLOYMENT_GUIDE.md`: установка с нуля через `deploy.sh`, контейнер `root-smm-1` (сейчас `smm`), `docker-compose down`/`up` без `-f`. **Содержит похожие на настоящие ключи Beget S3 в примерах (строки 62–64)** — отдельный вопрос к ротации секретов, не входит в эту уборку. |

## Что стоит забрать, а не выбросить

`.env.example` — единственное место, где были перечислены `BEGET_S3_*`, `GEMINI_API_KEY`,
`DIRECTUS_SECRET`, `N8N_ENCRYPTION_KEY`, `SMM_DB_NAME`.

Важная оговорка: отсутствие `BEGET_S3_*` и `GEMINI_API_KEY` в `/root/.env` — **не пробел**.
Эти ключи приложение подтягивает на старте из Directus (`global_api_keys`, см.
`server/services/load-env-from-directus.ts`), а `GEMINI_API_KEY` и `GEMINI_PROXY_URL` вообще
всегда перекрываются значением из Directus. Подробнее — в `docs/DEPLOYMENT.md`, раздел
«Окружение».

Реальный пробел в другом: полноценного шаблона переменных приложения в репозитории нет,
а корневой `.env.sample` — чужой инфраструктурный шаблон (Budibase/MinIO/CouchDB) и на эту
роль не годится. Отдельный follow-up, в уборку не входит.
