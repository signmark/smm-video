#!/bin/bash

echo "Создание резервной копии на старом сервере"

cd ~/smm

echo "Создание дампа схемы..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_full_schema.sql

echo "Создание дампа данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --data-only --no-owner --no-privileges --column-inserts > directus_full_data.sql

echo "Создание архива..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
tar -czf directus_complete_$TIMESTAMP.tar.gz directus_full_*.sql

echo "Резервная копия создана:"
ls -lh directus_complete_*.tar.gz

echo "Копирование на новый сервер..."
scp directus_complete_$TIMESTAMP.tar.gz root@31.128.43.113:/root/

echo "Готово! Архив скопирован на новый сервер"