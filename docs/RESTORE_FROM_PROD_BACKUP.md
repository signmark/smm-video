# Восстановление из бэкапа на проде

Бэкап лежит на сервере: **root@oladaymbzh** в каталоге **~/backup**:

```text
~/backup/all_databases_20260202_020001.sql
```

## Вариант 1: Скрипт из репозитория (рекомендуется)

На проде (в каталоге проекта, где есть `docker-compose` и скрипт):

```bash
# Перейти в каталог проекта
cd /path/to/smmniap   # или где у вас развёрнут проект

# Запустить восстановление (скрипт возьмёт ~/backup/all_databases_20260202_020001.sql)
bash scripts/restore_from_prod_backup.sh
```

Скрипт спросит подтверждение, пересоздаст БД `directus`, восстановит дамп и при наличии `docker-compose` перезапустит Directus.

**Если бэкап или Postgres в другом месте**, можно задать переменные:

```bash
BACKUP_DIR=/root/backup \
BACKUP_FILE=all_databases_20260202_020001.sql \
DB_NAME=directus \
bash scripts/restore_from_prod_backup.sh
```

## Вариант 2: Вручную (Docker Postgres)

На сервере **root@oladaymbzh**:

```bash
# 1) Остановить Directus
docker-compose stop directus

# 2) Узнать имя контейнера Postgres
docker ps | grep postgres

# 3) Пересоздать БД directus
docker exec -i ИМЯ_КОНТЕЙНЕРА psql -U postgres -c "DROP DATABASE IF EXISTS directus;"
docker exec -i ИМЯ_КОНТЕЙНЕРА psql -U postgres -c "CREATE DATABASE directus;"
docker exec -i ИМЯ_КОНТЕЙНЕРА psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;"

# 4) Восстановить дамп
docker exec -i ИМЯ_КОНТЕЙНЕРА psql -U postgres -d directus < ~/backup/all_databases_20260202_020001.sql

# 5) Запустить Directus
docker-compose up -d directus
```

Если файл **all_databases_*** — это дамп **всех** БД (pg_dumpall), то шаги 3–4 другие: не создавать БД вручную, а подать весь дамп в `psql -U postgres` (без `-d directus`). Скрипт `restore_from_prod_backup.sh` сам определяет тип дампа по наличию `CREATE DATABASE` в файле.

## После восстановления

- Зайти в админку Directus и проверить пользователей и коллекции.
- Убедиться, что в приложении в `.env` указаны актуальные `DIRECTUS_URL` и `DIRECTUS_TOKEN` (или `DIRECTUS_STATIC_TOKEN`) для этого инстанса.
