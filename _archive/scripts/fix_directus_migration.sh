#!/bin/bash

set -e

echo "Исправление проблемы с миграциями Directus"

cd /root

# Останавливаем Directus
echo "Остановка Directus..."
docker-compose stop directus

echo "Полная очистка базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres << 'PSQL_SCRIPT'
DROP DATABASE IF EXISTS directus;
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

echo "Запуск Directus для инициализации чистой схемы..."
docker-compose up -d directus

echo "Ожидание инициализации..."
sleep 30

echo "Проверка логов инициализации..."
docker-compose logs directus --tail 10

echo "Остановка Directus для восстановления данных..."
docker-compose stop directus

echo "Восстановление только пользовательских данных..."
if [ -f "directus_auth_export.sql" ]; then
    echo "Восстановление пользователей..."
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_auth_export.sql
fi

if [ -f "directus_user_data_export.sql" ]; then
    echo "Восстановление пользовательских данных..."
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_user_data_export.sql
fi

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска..."
sleep 15

echo "Проверка логов..."
docker-compose logs directus --tail 20

echo "Готово! Directus должен работать на https://directus.roboflow.tech"