# Handoff: Claude — уборка параллельных путей деплоя — 2026-07-26

**Ревьюер по канону: Mimo** (`AGENTS.md`, п.3 — изменения в Docker / CI / deploy-скриптах).

## Задача

Поручение owner'а: в репозитории живёт параллельный путь деплоя, противоречащий фактическому.
Фактический прод — `/root/docker-compose.yml`, сервис `smm`, build context `./smm` с корневым
`Dockerfile`, образ `root-smm`, окружение только из `/root/.env` через `env_file`, наружу через
traefik на `smm.omemo.tech`. Файла `/root/smm/.env` нет намеренно. Требовалось: определить, что
в `deploy/` актуально, неактуальное убрать, актуальный путь описать одним документом, и
отдельно разобраться с `server/load-env.ts`.

## Что найдено

**Актуального в `deploy/` не оказалось ничего.** Весь каталог пришёл одним коммитом `63181cd5`
(«Initial commit», 2026-05-18, импорт из Replit) и с тех пор не менялся ни разу. Ссылок из
кода, `package.json` и CI нет (CI в проекте отсутствует).

**Сверх постановки нашёлся второй, более опасный набор** — `scripts/deploy/` (4 скрипта) плюс
`docs/deployment/FULL_DEPLOYMENT_GUIDE.md`, который предписывал их запускать. `scripts/deploy/deploy.sh`,
запущенный из `/root` (как и написано в гайде), делает `docker system prune -a -f`,
**перезаписывает `/root/docker-compose.yml`** копией `fixed-docker-compose.yml` (dev-режим,
`npm run dev`, bind-mount) и **перезаписывает `/root/.env`** шаблоном с плейсхолдерами. Шаги с
перезаписью сегодня не срабатывают только потому, что исходные файлы в корне репозитория
отсутствуют; `prune` и `up -d --build` сработают.

Этот набор архивирован вместе с остальным — он ровно та же проблема, что и `deploy/`.

## Уточнение к постановке

Пункт про `deploy/start.sh:29-38` («создаст `/root/smm/.env`») неточен, хотя на вывод не влияет.
Скрипт на строке 10 делает `cd "$SCRIPT_DIR"`, поэтому `cp ../.env .env` копировал бы
`/root/smm/.env` → `/root/smm/deploy/.env`. То есть источником был именно тот файл, которого
нет, и сегодня скрипт падает на строке 35 ещё до всего остального. Реальная опасность
`start.sh` в другом: строки 106–117 делают `docker stop` всему, что публикует порты 80/443
(то есть прод-traefik), а строка 147 поднимает стек с теми же `container_name`. Итог запуска —
прод лежит, новый стек не встаёт из-за конфликта имён. `docker-compose` на хосте не мёртвый
v1, а шим на Compose v5, так что команда бы отработала.

Опасность «положить копию `/root/.env` внутрь репозитория» при этом реальна — просто её
источник в `scripts/deploy/`, а не в `deploy/start.sh`.

## Что сделано

1. **`deploy/` → `_archive/deploy/`** целиком (27 файлов). В `deploy/` оставлен только
   `README.md`-надгробие: куда всё делось и почему не класть сюда compose-файлы.
2. **`scripts/deploy/` → `_archive/deploy/scripts-deploy/`** (4 скрипта).
3. **`docs/deployment/FULL_DEPLOYMENT_GUIDE.md` → `_archive/deploy/`**.
4. Со всех архивированных `.sh` снят бит запуска (`chmod -x`).
5. **`_archive/deploy/README.md`** — разбор: почему всё целиком, что именно было опасно
   (построчно по `deploy.sh`, `start.sh`, `redeploy.sh`), таблица по каждому файлу.
6. **`docs/DEPLOYMENT.md`** — новый канон: compose-файл, окружение, команды `build`/`up -d`,
   быстрая выкладка фронта через `docker cp`, правила («всегда `-f`», «всегда сервис `smm`»,
   «не `down`, не `prune`»), проверка после деплоя, состав compose-проекта `root`.
7. **`.mimocode/skills/commit-and-rebuild/SKILL.md`** — несуществующие `smm-rebuild` / `smm-test`
   заменены на `docker compose -f /root/docker-compose.yml build smm` + `... up -d smm` и
   `npx vitest run`. Заодно поправлен путь бандла: `dist/server/index.js`, а не `.mjs`
   (см. `--outfile` в `package.json:14`).
8. **`server/load-env.ts`** — поведение не изменено, добавлено предупреждение: если `.env`
   реально перекрыл уже заданные переменные окружения и `NODE_ENV=production`, в лог уходит
   warn с именами перекрытых переменных (без значений) и указанием удалить файл. Набор ключей
   и `NODE_ENV` фиксируются **до** `dotenv.config`, иначе `override: true` затирает и их.
9. Правки ссылок: `docs/TROUBLESHOOTING_404.md` (описывал `deploy/smm/Dockerfile` как рабочий
   вариант), `docs/deployment/deploy-instructions.md` (половина файла была про `deploy.sh`;
   верная шапка и находки по `useAuth()` сохранены), `docs/deployment/README.md`,
   комментарий в `server/utils/environment-detector.ts:27`.

`docs/prompts/*` не трогал — это датированные исторические артефакты.

## Второй заход (после «продолжай»)

**Контрольная зачистка.** `git ls-files | grep docker-compose` вне `_archive/` — **ноль
файлов**. То есть `docker compose` без `-f`, запущенный из любого каталога репозитория,
теперь просто не найдёт compose-файл. Из Dockerfile'ов вне архива остались только рабочие:
корневой `Dockerfile` (прод-сервис `smm`) и `video-app/Dockerfile` (прод-сервис `video-app`,
context `./smm/video-app`).

10. **Корневой `Dockerfile-n8n` → `_archive/deploy/Dockerfile-n8n-root`.** Прод-n8n собран
    из `image: n8nio/n8n:latest`, build не используется; ссылались на него только архивные
    compose-файлы. В самом файле битая кодировка комментариев и захардкоженный
    `N8N_ENCRYPTION_KEY=your_secret_key_here`.
11. **`.dockerignore`: добавлен `_archive/`.** Архивные compose/Dockerfile не должны попадать
    в build context и в builder-стадию через `COPY . .`. Проверено: никто из
    `server/`/`client/`/`shared/`/`scripts/` из `_archive` не импортирует.

### Найденная ошибка в моём же первом заходе

В первой версии `docs/DEPLOYMENT.md` я написал «шаблон переменных приложения — `.env.sample`»
и вынес в follow-up «`.env.sample` не покрывает `BEGET_S3_*` и `GEMINI_API_KEY`». **Оба
утверждения неверны**, проверил при подготовке follow-up'а:

- корневой `.env.sample` — вообще не про это приложение: чужой инфраструктурный шаблон
  (Budibase, MinIO, CouchDB, Appsmith), ни одной переменной SMM в нём нет;
- `BEGET_S3_*` и `GEMINI_API_KEY` отсутствуют в `/root/.env` **намеренно** — они приходят
  на старте из Directus (`global_api_keys`).

### Третий источник окружения — и он не был описан

Задача формулировалась как «окружение — только `/root/.env`». Это верно для файлового
источника, но в контейнере переменные складываются из трёх мест:

1. `env_file: .env` → `/root/.env` (44 переменные);
2. `environment:` в compose — `NODE_ENV`, `PORT`, `DIRECTUS_URL`, `VIDEO_APP_HOST`,
   перекрывают `.env`;
3. **Directus, коллекция `global_api_keys`** — `server/services/load-env-from-directus.ts`
   тянет на старте 16 ключей (`BEGET_S3_*`, `GEMINI_API_KEY`, `VERTEX_AI_API_KEY`,
   `TELEGRAM_BOT_TOKEN`, `N8N_*`-вебхуки, `SCRAPER_ANALYTICS_API_KEY`).

Причём `GEMINI_API_KEY`, `GEMINI_PROXY_URL`, `SCRAPER_ANALYTICS_API_KEY` перекрывают env
**всегда** (`ALWAYS_OVERRIDE_FROM_DIRECTUS`) — правка `/root/.env` по ним ни на что не влияет,
менять надо в Directus. Загрузка не блокирующая: таймаут 12 с, при сбое старт продолжается на
env-фоллбэках с warn'ом `[load-env-directus]`.

Раздел «Окружение» в `docs/DEPLOYMENT.md` переписан под это, ложные утверждения убраны,
follow-up в `_archive/deploy/README.md` исправлен. **Mimo: это ключевое место для сверки** —
если моя реконструкция приоритетов расходится с тем, что ты видишь на проде, скажи.

## Верификация (мой прогон)

- `npx vitest run`: **12 failed | 928 passed (940)**, 89 файлов, ~20с.
  - **Дельта:** прогнал тот же suite с застэшенными изменениями в `server/` — ровно
    **12 failed | 928 passed (940)**. Регрессий ноль. Падающие файлы:
    `publish-scheduler-routing.test.ts`, `scheduler-admin-gate.test.ts` — это известный фон
    из-за намеренно отсутствующего `/root/smm/.env`, не связан с этой задачей.
- `npx tsc --noEmit`: по `server/load-env.ts` и `server/utils/environment-detector.ts` — чисто.
  В выводе остаются 3 предсуществующие ошибки в `server/services/web-crawler-agent.ts` и
  `server/telegram-bot/index.ts` — не мои файлы, не трогал.
- Прицельно: `npx vitest run server/__tests__/environment-detector.test.ts server/__tests__/logger.test.ts`
  → 19/19 passed.
- Сборка сервера: `npx esbuild server/index.ts --bundle ...` (та же команда, что в `npm run build`)
  → проходит, 3.5mb.
- Фронт не менялся.
- **Второй заход:** `docker build --target builder` с новым `.dockerignore` проходит
  (builder-стадия — это как раз `COPY . .` + `npm run build`). Тестовый образ удалён,
  `root-smm:latest` не тронут. Повторный `npx vitest run` — те же 12 failed | 928 passed.
- Прод не трогал: ни одной команды, меняющей состояние Docker, не выполнялось. Провенанс
  подтверждён только чтением:
  `docker inspect smm --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'`
  → `/root/docker-compose.yml`, проект `root`, образ `root-smm`.

## Компромиссы и отклонения

- **Архив вместо удаления.** `_archive/` — уже принятая в репозитории конвенция
  (`_archive/docs/`, `_archive/scripts/`). Историю сохраняем, но с `chmod -x` и README,
  запрещающим запуск. `bash <файл>` снятый бит не остановит — поэтому файлы уведены из
  рабочих путей, а не просто помечены.
- **Расширение скоупа на `scripts/deploy/` и `docs/deployment/`.** В постановке их не было,
  но это та же проблема, причём худшая её версия. Оставить их означало бы закрыть задачу
  наполовину. Если Mimo считает, что это надо отдельным коммитом — легко расщепить.
- **`deploy/` не удалён совсем**, оставлено надгробие. Логика: `docker compose` без `-f`
  подхватывает файл из текущего каталога, и пустой каталог с предупреждением дешевле, чем
  риск, что кто-то заново создаст там compose.
- **`load-env.ts`: warn, а не throw.** Падать в проде из-за лишнего файла — хуже болезни.
  Warn гейтится на `NODE_ENV=production`, чтобы не шуметь на Replit/локально, где `.env`
  и должен пересиливать окружение.
- `docs/deployment/SERVER_STARTUP_ISSUES.md` оставлен как есть — исторический постмортем
  (2025-04-04), не конкурирующая инструкция по деплою.

## Известные ограничения / не сделано

- **Секреты в `_archive/deploy/FULL_DEPLOYMENT_GUIDE.md`, строки 62–64** — похожие на
  настоящие Access/Secret Key Beget S3 в «примерах». Файл переехал, но содержимое не менял:
  ротация утёкших в историю токенов — отложенное решение owner'а, не моя правка.
- **Шаблона переменных приложения в репозитории нет.** Корневой `.env.sample` на эту роль не
  годится (см. выше). Сделать нормальный `.env.example` — отдельная задача: 110 переменных,
  и по каждой надо решить, обязательная она, есть ли фоллбэк и не приходит ли она из Directus.
  Делать наспех хуже, чем не делать: неверный шаблон в каноне дороже отсутствующего.
- **Секреты в архиве** — см. выше, решение owner'а.
- `docs/deployment/SERVER_STARTUP_ISSUES.md` — исторический постмортем 2025-04-04, оставлен.
- `docs/` (2.6 МБ) по-прежнему попадает в build context и инвалидирует слой `COPY . .` при
  любой правке доков. В образ не входит (из builder копируются только `dist`,
  `client/public`, `smmniap_static`), так что это про скорость сборки, а не про размер.
  Не добавлял в `.dockerignore`: менять поведение прод-сборки сверх необходимого не стал.
- Изменения не пушились.

## Вопросы к ревьюеру / owner'у

1. Mimo: расщеплять ли коммит на «deploy/» и «scripts/deploy/» отдельно?
2. Owner: удалять ли `_archive/deploy/` совсем в следующий заход, или архива достаточно?

## Следующий шаг (по ролям)

- **Mimo:** ревью как второй ревьюер по Docker/deploy. Ключевое к проверке — `docs/DEPLOYMENT.md`
  (команды соответствуют тому, чем ты реально деплоишь?) и `.mimocode/skills/commit-and-rebuild/SKILL.md`.
- **Owner (Dmitry):** gate + push.
- **DO NOT FIX:** содержимое `_archive/**` — оно архив, править его смысла нет.
  Секреты в `FULL_DEPLOYMENT_GUIDE.md` — только по явному решению owner'а о ротации.
