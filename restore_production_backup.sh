#!/bin/bash

LOG_FILE="./production_restore_$(date +%Y%m%d_%H%M%S).log"

echo "🔄 Восстановление из продакшен бэкапа" | tee -a $LOG_FILE

# Создаем папку для бэкапов
mkdir -p ./backup

# Скачиваем бэкап с продакшена (без интерактивного подтверждения)
echo "📥 Скачивание бэкапа..." | tee -a $LOG_FILE
scp -o StrictHostKeyChecking=no root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./backup/ 2>&1 | tee -a $LOG_FILE

if [ ! -f "./backup/all_databases_20250605_111645.sql" ]; then
    echo "❌ Не удалось скачать файл. Проверим что есть в продакшен папке..." | tee -a $LOG_FILE
    ssh -o StrictHostKeyChecking=no root@31.128.43.113 "ls -la /root/backup/" 2>&1 | tee -a $LOG_FILE
    exit 1
fi

echo "✅ Файл скачан: $(du -h ./backup/all_databases_20250605_111645.sql | cut -f1)" | tee -a $LOG_FILE

# Остановка сервисов
echo "⏹️ Остановка сервисов..." | tee -a $LOG_FILE
docker-compose stop 2>&1 | tee -a $LOG_FILE

# Запуск PostgreSQL
echo "🚀 Запуск PostgreSQL..." | tee -a $LOG_FILE
docker-compose up -d postgres 2>&1 | tee -a $LOG_FILE

sleep 15

# Пересоздание базы directus
echo "🗄️ Пересоздание базы directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;" 2>&1 | tee -a $LOG_FILE

# Создание временной базы для полного восстановления
echo "🗄️ Создание временной базы..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS temp_restore;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Восстановление полного бэкапа во временную базу
echo "📥 Восстановление полного бэкапа..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d temp_restore < ./backup/all_databases_20250605_111645.sql 2>&1 | tee -a $LOG_FILE

# Экспорт данных Directus
echo "📤 Экспорт данных Directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 pg_dump -U postgres -d temp_restore \
    --schema=public \
    -t "directus_*" \
    -t "business_questionnaire" \
    -t "campaign_*" \
    -t "user_*" \
    -t "global_api_keys" \
    -t "post_comment" \
    -t "source_posts" \
    -t "content_sources" \
    > ./directus_production.sql 2>&1 | tee -a $LOG_FILE

# Восстановление в базу directus
echo "📥 Восстановление в directus..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d directus < ./directus_production.sql 2>&1 | tee -a $LOG_FILE

# Удаление временной базы
echo "🗑️ Удаление временной базы..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Запуск всех сервисов
echo "🚀 Запуск сервисов..." | tee -a $LOG_FILE
docker-compose up -d 2>&1 | tee -a $LOG_FILE

sleep 20

echo "✅ Восстановление завершено!" | tee -a $LOG_FILE
echo "📝 Лог: $LOG_FILE" | tee -a $LOG_FILE

# Проверка данных
echo "🔍 Проверка восстановленных данных..." | tee -a $LOG_FILE
node check_database_structure.js 2>&1 | tee -a $LOG_FILE