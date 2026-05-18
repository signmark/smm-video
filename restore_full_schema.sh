#!/bin/bash

set -e

echo "Восстановление полной схемы Directus"

# Работаем в текущей директории

echo "Остановка Directus..."
docker-compose stop directus

echo "Полная очистка и пересоздание базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres << 'PSQL_SCRIPT'
DROP DATABASE IF EXISTS directus;
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

echo "Восстановление полной схемы из дампа..."
if [ -f "directus_schema_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_schema_export.sql
    echo "Схема восстановлена"
else
    echo "Файл схемы не найден!"
    exit 1
fi

echo "Проверка созданных таблиц..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%user%' ORDER BY tablename;"

echo "Восстановление данных пользователей..."
if [ -f "directus_auth_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_auth_export.sql 2>&1 | grep -v "already exists" || true
    echo "Данные авторизации восстановлены"
fi

echo "Восстановление пользовательских данных..."
if [ -f "directus_user_data_export.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_user_data_export.sql 2>&1 | grep -v "already exists" || true
    echo "Пользовательские данные восстановлены"
fi

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска..."
sleep 20

echo "Проверка логов..."
docker-compose logs directus --tail 15

echo ""
echo "Проверка пользователей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT id, email, first_name, last_name, status FROM directus_users;"

echo ""
echo "Проверка кампаний:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT COUNT(*) as campaigns_count FROM user_campaigns;" 2>/dev/null || echo "Таблица user_campaigns все еще не найдена"

echo ""
echo "Готово! Попробуйте войти в Directus с учетными данными со старого сервера"