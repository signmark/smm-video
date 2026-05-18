#!/bin/bash

echo "Восстановление только пользователей и ролей"

cd /root

echo "Остановка текущих процессов..."
docker-compose stop directus || true

echo "Пересоздание базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "DROP DATABASE IF EXISTS directus;"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "CREATE DATABASE directus;"

echo "Запуск Directus для создания базовой схемы..."
docker-compose up -d directus
sleep 30

echo "Остановка для добавления пользователей..."
docker-compose stop directus

echo "Извлечение только пользователей из дампа..."
if [ -f "directus_full_data.sql" ]; then
    grep -A5 -B5 "INSERT INTO.*directus_users" directus_full_data.sql > users_only.sql
    grep -A5 -B5 "INSERT INTO.*directus_roles" directus_full_data.sql >> users_only.sql
    grep -A5 -B5 "INSERT INTO.*directus_policies" directus_full_data.sql >> users_only.sql
    
    echo "Восстановление только пользователей..."
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < users_only.sql
fi

echo "Запуск Directus..."
docker-compose up -d directus
sleep 20

echo "Проверка пользователей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name FROM directus_users;"

echo "Готово! Пользователи восстановлены"