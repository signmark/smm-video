#!/bin/bash

set -e

echo "🔄 Восстановление Directus из резервной копии"

cd /root

# Найти последний архив миграции
ARCHIVE_NAME=$(ls -t directus_migration_*.tar.gz 2>/dev/null | head -1)

if [ -z "$ARCHIVE_NAME" ]; then
    echo "❌ Архив миграции не найден!"
    echo "Убедитесь что файл directus_migration_*.tar.gz находится в /root/"
    exit 1
fi

echo "📦 Найден архив: $ARCHIVE_NAME"

echo "Распаковка архива..."
tar -xzf $ARCHIVE_NAME

echo "Остановка Directus..."
docker-compose stop directus 2>/dev/null || true

echo "Пересоздание базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres << 'PSQL_SCRIPT'
DROP DATABASE IF EXISTS directus;
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

echo "Восстановление схемы..."
if [ -f "directus_schema_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_schema_export.sql
    echo "✅ Схема восстановлена"
else
    echo "❌ Файл схемы не найден!"
fi

echo "Восстановление пользователей и ролей..."
if [ -f "directus_auth_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_auth_export.sql
    echo "✅ Система авторизации восстановлена"
else
    echo "❌ Файл авторизации не найден!"
fi

echo "Восстановление пользовательских данных..."
if [ -f "directus_user_data_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_user_data_export.sql
    echo "✅ Пользовательские данные восстановлены"
else
    echo "❌ Файл пользовательских данных не найден!"
fi

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска..."
sleep 15

echo "Проверка логов Directus..."
docker-compose logs directus --tail 20

echo "✅ Восстановление завершено!"
echo "🌐 Directus доступен по адресу: https://directus.roboflow.tech"
echo "👤 Войдите с теми же учетными данными что были на старом сервере"