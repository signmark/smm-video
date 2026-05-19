#!/bin/bash

cat << 'EOF'
=== ИНСТРУКЦИЯ ПО МИГРАЦИИ DIRECTUS ===

ШАГИ ДЛЯ ВЫПОЛНЕНИЯ:

1. НА СТАРОМ СЕРВЕРЕ (45.130.212.62):
   cd ~/smm
   
   # Создать полные дампы
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_full_schema.sql
   
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --data-only --no-owner --no-privileges --column-inserts > directus_full_data.sql
   
   # Создать архив
   tar -czf directus_complete_$(date +%Y%m%d_%H%M%S).tar.gz directus_full_*.sql
   
   # Скопировать на новый сервер
   scp directus_complete_*.tar.gz root@31.128.43.113:/root/

2. НА НОВОМ СЕРВЕРЕ (31.128.43.113):
   cd /root
   
   # Удалить базу данных через PGAdmin или командой:
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "DROP DATABASE IF EXISTS directus;"
   
   # Создать новую базу
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -c "CREATE DATABASE directus; GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;"
   
   # Распаковать архив
   tar -xzf directus_complete_*.tar.gz
   
   # Восстановить схему
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_schema.sql
   
   # Восстановить данные
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_data.sql
   
   # Запустить Directus
   docker-compose up -d directus
   
   # Проверить результат
   sleep 20
   docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name FROM directus_users;"

=== ГОТОВО ===
После выполнения этих команд Directus будет работать на https://directus.roboflow.tech
Войдите с учетными данными пользователей со старого сервера
EOF