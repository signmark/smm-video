#!/bin/bash
# Восстановление из бэкапа на проде: ~/backup/all_databases_20260202_020001.sql
# Запуск на сервере: bash scripts/restore_from_prod_backup.sh
# Или: BACKUP_DIR=~/backup BACKUP_FILE=all_databases_20260202_020001.sql bash scripts/restore_from_prod_backup.sh

set -e

BACKUP_DIR="${BACKUP_DIR:-$HOME/backup}"
BACKUP_FILE="${BACKUP_FILE:-all_databases_20260202_020001.sql}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"
DB_NAME="${DB_NAME:-directus}"

echo "=== Восстановление из бэкапа ==="
echo "Файл: $BACKUP_PATH"
echo "БД:   $DB_NAME"
echo ""

if [ ! -f "$BACKUP_PATH" ]; then
  echo "Ошибка: файл не найден: $BACKUP_PATH"
  echo "Проверьте: ls $BACKUP_DIR"
  exit 1
fi

# Определяем, как запущен Postgres: docker или локально
if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q postgres; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)
  echo "Используем Docker-контейнер Postgres: $CONTAINER"
  PSQL_CMD="docker exec -i $CONTAINER psql -U postgres"
  PSQL_DB="docker exec -i $CONTAINER psql -U postgres -d $DB_NAME"
else
  echo "Используем локальный psql"
  PSQL_CMD="psql -U postgres"
  PSQL_DB="psql -U postgres -d $DB_NAME"
fi

# Если дамп содержит все БД (pg_dumpall), в нём есть CREATE DATABASE
# Тогда создаём БД заново и катим дамп целиком
if grep -q "CREATE DATABASE" "$BACKUP_PATH" 2>/dev/null; then
  echo "Обнаружен дамп всех БД (pg_dumpall)."
  read -p "Пересоздать БД $DB_NAME и восстановить всё? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[yY]$ ]]; then
    echo "Отменено."
    exit 0
  fi
  echo "Останавливаем Directus (если есть docker-compose)..."
  docker-compose stop directus 2>/dev/null || true
  echo "Восстановление полного дампа..."
  $PSQL_CMD < "$BACKUP_PATH"
  echo "Запускаем Directus..."
  docker-compose up -d directus 2>/dev/null || true
else
  # Один дамп одной БД — пересоздаём БД и катим в неё
  echo "Восстановление дампа в БД: $DB_NAME"
  read -p "Пересоздать БД $DB_NAME и восстановить дамп? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[yY]$ ]]; then
    echo "Отменено."
    exit 0
  fi
  echo "Останавливаем Directus (если есть docker-compose)..."
  docker-compose stop directus 2>/dev/null || true
  echo "Пересоздание БД $DB_NAME..."
  $PSQL_CMD -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true
  $PSQL_CMD -c "DROP DATABASE IF EXISTS $DB_NAME;"
  $PSQL_CMD -c "CREATE DATABASE $DB_NAME;"
  $PSQL_CMD -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO postgres;"
  echo "Восстановление дампа в $DB_NAME..."
  $PSQL_DB < "$BACKUP_PATH"
  echo "Запускаем Directus..."
  docker-compose up -d directus 2>/dev/null || true
fi

echo ""
echo "Проверка таблиц в $DB_NAME:"
$PSQL_DB -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 20;" 2>/dev/null || true

echo ""
echo "Проверка пользователей Directus:"
$PSQL_DB -c "SELECT id, email, first_name, last_name, status FROM directus_users LIMIT 5;" 2>/dev/null || echo "(таблица directus_users не найдена или пуста)"

echo ""
echo "=== Готово. Зайдите в Directus и проверьте данные. ==="
