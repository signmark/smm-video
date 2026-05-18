#!/bin/bash

echo "Проверка результата восстановления базы данных"

echo "Статус контейнеров:"
docker-compose ps

echo ""
echo "Проверка пользователей в базе данных:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name, status FROM directus_users ORDER BY email;"

echo ""
echo "Проверка кампаний:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT COUNT(*) as campaigns_count FROM user_campaigns;" 2>/dev/null || echo "Таблица user_campaigns не найдена"

echo ""
echo "Проверка API ключей:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT service_name, is_active FROM global_api_keys;" 2>/dev/null || echo "Таблица global_api_keys не найдена"

echo ""
echo "Логи Directus:"
docker-compose logs directus --tail 10

echo ""
echo "Тест доступа к Directus:"
curl -s -o /dev/null -w "%{http_code}" https://directus.roboflow.tech/ || echo "Ошибка подключения"