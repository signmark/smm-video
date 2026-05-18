#!/bin/bash

set -e

echo "Восстановление Directus из полного дампа"

# Найти архив
ARCHIVE=$(ls -t directus_complete_*.tar.gz 2>/dev/null | head -1)
if [ -z "$ARCHIVE" ]; then
    echo "Архив directus_complete_*.tar.gz не найден!"
    echo "Убедитесь что вы скопировали архив с первого сервера"
    exit 1
fi

echo "Найден архив: $ARCHIVE"
echo "Распаковка..."
tar -xzf "$ARCHIVE"

echo "Создание новой базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres << 'PSQL_SCRIPT'
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

echo "Восстановление схемы..."
if [ -f "directus_full_schema.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_schema.sql
    echo "Схема восстановлена"
else
    echo "Файл схемы не найден!"
    exit 1
fi

echo "Восстановление данных..."
if [ -f "directus_full_data.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_data.sql
    echo "Данные восстановлены"
else
    echo "Файл данных не найден!"
    exit 1
fi

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска..."
sleep 20

echo "Проверка пользователей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name FROM directus_users;"

echo "Проверка логов:"
docker-compose logs directus --tail 10

echo "Готово! Directus восстановлен на https://directus.roboflow.tech"