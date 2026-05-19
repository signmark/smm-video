#!/bin/bash

set -e

echo "Ручное восстановление пользователей Directus"

cd /root

echo "Проверка содержимого файла авторизации..."
grep -i "INSERT INTO" directus_auth_export.sql | head -5

echo ""
echo "Попытка восстановления пользователей..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus << 'EOF'
\set ON_ERROR_STOP on

-- Очистка существующих пользователей кроме admin
DELETE FROM directus_users WHERE email != 'admin@roboflow.tech';

-- Восстановление из дампа
EOF

echo "Применение дампа авторизации..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_auth_export.sql 2>&1 | grep -v "already exists" | head -20

echo ""
echo "Проверка пользователей после восстановления:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT id, email, first_name, last_name, status FROM directus_users;"

echo ""
echo "Попытка восстановления пользовательских данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_user_data_export.sql 2>&1 | grep -v "already exists" | head -20

echo ""
echo "Финальная проверка пользователей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT id, email, first_name, last_name, status FROM directus_users;"

echo ""
echo "Проверка кампаний пользователей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT COUNT(*) as campaigns_count FROM user_campaigns;" 2>/dev/null || echo "Таблица user_campaigns не найдена"

echo ""
echo "Перезапуск Directus..."
docker-compose restart directus

echo "Ожидание запуска..."
sleep 15

echo "Проверка логов:"
docker-compose logs directus --tail 10