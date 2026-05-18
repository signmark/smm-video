#!/bin/bash

echo "Пошаговое восстановление базы данных"

cd /root

echo "Шаг 1: Остановка Directus..."
docker-compose stop directus

echo "Шаг 2: Удаление базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "DROP DATABASE IF EXISTS directus;"

echo "Шаг 3: Создание новой базы данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "CREATE DATABASE directus;"

echo "Шаг 4: Выдача прав..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;"

echo "Шаг 5: Распаковка архива..."
LATEST_ARCHIVE=$(ls -t directus_complete_*.tar.gz | head -1)
echo "Используем архив: $LATEST_ARCHIVE"
tar -xzf "$LATEST_ARCHIVE"

echo "Шаг 6: Проверка файлов..."
ls -la directus_full_*.sql

echo "Шаг 7: Восстановление схемы..."
if [ -f "directus_full_schema.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_schema.sql
    echo "Схема восстановлена"
else
    echo "Файл схемы не найден!"
    exit 1
fi

echo "Шаг 8: Восстановление данных..."
if [ -f "directus_full_data.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_data.sql
    echo "Данные восстановлены"
else
    echo "Файл данных не найден!"
    exit 1
fi

echo "Шаг 9: Запуск Directus..."
docker-compose up -d directus

echo "Шаг 10: Ожидание запуска..."
sleep 25

echo "Шаг 11: Проверка пользователей..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name FROM directus_users;"

echo "Готово!"