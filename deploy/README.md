# deploy/ — пусто, и так и должно быть

Прод поднимается из `/root/docker-compose.yml` (вне репозитория), сервис `smm`,
Dockerfile — корневой `Dockerfile`, окружение — только `/root/.env`.

**Канон: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).**

Всё, что раньше лежало в этом каталоге (`start.sh`, `redeploy.sh` и четыре варианта
`docker-compose*.yml`), к проду отношения не имело и переехало в
[`_archive/deploy/`](../_archive/deploy/) — там же разбор, почему.

Не класть сюда compose-файлы и деплой-скрипты: команда `docker compose` без `-f`
подхватывает файл из текущего каталога, и параллельный стек с теми же `container_name`
и портами 80/443 роняет прод. Если нужен новый деплой-инструмент — сначала обновить
`docs/DEPLOYMENT.md`, ревью по `AGENTS.md` с Mimo вторым ревьюером.
