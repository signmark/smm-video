#!/bin/bash

echo "🔄 Восстановление базы данных из бэкапа"

cd /root

# Остановить все сервисы
echo "⏹️ Остановка сервисов..."
docker-compose stop

# Запустить только PostgreSQL
echo "🗄️ Запуск PostgreSQL..."
docker-compose up -d postgres

# Подождать запуска PostgreSQL
echo "⏳ Ожидание запуска PostgreSQL..."
sleep 15

# Восстановить базу данных
echo "🗄️ Удаление старой базы данных..."
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;"

echo "🗄️ Создание новой базы данных..."
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;"

echo "📥 Восстановление данных из бэкапа..."
docker exec -i root-postgres-1 psql -U postgres < /root/backup/all_databases_20250606_020001.sql

# Запустить Directus
echo "🚀 Запуск Directus..."
docker-compose up -d directus

# Подождать запуска Directus
echo "⏳ Ожидание запуска Directus..."
sleep 15

# Запустить все остальные сервисы
echo "🚀 Запуск всех сервисов..."
docker-compose up -d

echo "✅ Восстановление завершено!"
docker-compose ps