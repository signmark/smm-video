#!/bin/bash

echo "Создание базы данных и восстановление"

cd /root

echo "Шаг 1: Создание базы данных directus..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "CREATE DATABASE directus;"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;"

echo "Шаг 2: Проверка созданной базы..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "\l" | grep directus

echo "Шаг 3: Поиск архива..."
LATEST_ARCHIVE=$(ls -t directus_complete_*.tar.gz 2>/dev/null | head -1)
if [ -z "$LATEST_ARCHIVE" ]; then
    echo "Архив не найден. Доступные файлы:"
    ls -la directus_*
    echo "Сначала создайте архив на старом сервере"
    exit 1
fi

echo "Используем архив: $LATEST_ARCHIVE"

echo "Шаг 4: Распаковка архива..."
tar -xzf "$LATEST_ARCHIVE"

echo "Шаг 5: Проверка распакованных файлов..."
ls -la directus_full_*.sql

echo "Шаг 6: Восстановление схемы..."
if [ -f "directus_full_schema.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_schema.sql
    echo "Схема восстановлена"
else
    echo "Файл схемы не найден!"
    exit 1
fi

echo "Шаг 7: Восстановление данных..."
if [ -f "directus_full_data.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_data.sql
    echo "Данные восстановлены"
else
    echo "Файл данных не найден!"
    exit 1
fi

echo "Шаг 8: Запуск Directus..."
docker-compose up -d directus

echo "Шаг 9: Ожидание запуска..."
sleep 20

echo "Шаг 10: Проверка пользователей..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name FROM directus_users;"

echo "Готово!"