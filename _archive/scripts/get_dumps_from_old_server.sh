#!/bin/bash

echo "Получение дампов с первого сервера..."

# Выполнить команды на старом сервере для создания дампов
cat > create_dumps_remote.sh << 'EOF'
#!/bin/bash
cd ~/smm
echo "Создание дампа полной схемы..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_full_schema.sql

echo "Создание дампа только данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --data-only --no-owner --no-privileges --column-inserts > directus_full_data.sql

echo "Архивация..."
tar -czf directus_complete_$(date +%Y%m%d_%H%M%S).tar.gz directus_full_*.sql

ls -lh directus_complete_*.tar.gz
EOF

echo "Команды для выполнения на старом сервере (45.130.212.62):"
echo "1. Скопируйте создайте файл create_dumps_remote.sh с содержимым выше"
echo "2. Выполните: chmod +x create_dumps_remote.sh && ./create_dumps_remote.sh"
echo "3. Скопируйте получившийся архив directus_complete_*.tar.gz на новый сервер"

echo ""
echo "После получения архива запустите restore_from_complete_dump.sh"