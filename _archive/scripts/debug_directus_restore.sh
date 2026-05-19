#!/bin/bash

echo "Диагностика восстановления данных Directus"

cd /root

echo "Проверка наличия файлов дампа:"
ls -la directus_*_export.sql 2>/dev/null || echo "Файлы дампа не найдены"

echo ""
echo "Проверка архивов:"
ls -la directus_migration_*.tar.gz 2>/dev/null || echo "Архивы не найдены"

echo ""
echo "Проверка содержимого последнего архива:"
LATEST_ARCHIVE=$(ls -t directus_migration_*.tar.gz 2>/dev/null | head -1)
if [ -n "$LATEST_ARCHIVE" ]; then
    echo "Архив: $LATEST_ARCHIVE"
    tar -tzf "$LATEST_ARCHIVE"
    echo ""
    echo "Распаковка архива..."
    tar -xzf "$LATEST_ARCHIVE"
    echo "Файлы после распаковки:"
    ls -la directus_*_export.sql 2>/dev/null
else
    echo "Архивы миграции не найдены"
fi

echo ""
echo "Проверка текущих пользователей в базе:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT id, email, first_name, last_name FROM directus_users;" 2>/dev/null || echo "Ошибка подключения к базе"

echo ""
echo "Проверка размера файлов дампа:"
if [ -f "directus_auth_export.sql" ]; then
    echo "Размер файла авторизации: $(wc -l < directus_auth_export.sql) строк"
    echo "Первые 10 строк файла авторизации:"
    head -10 directus_auth_export.sql
else
    echo "Файл directus_auth_export.sql не найден"
fi

if [ -f "directus_user_data_export.sql" ]; then
    echo "Размер файла пользовательских данных: $(wc -l < directus_user_data_export.sql) строк"
    echo "Первые 10 строк файла пользовательских данных:"
    head -10 directus_user_data_export.sql
else
    echo "Файл directus_user_data_export.sql не найден"
fi