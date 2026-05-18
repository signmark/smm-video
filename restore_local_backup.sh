#!/bin/bash

LOG_FILE="./restore_$(date +%Y%m%d_%H%M%S).log"

echo "🔄 Восстановление из локального бэкапа" | tee -a $LOG_FILE

# Проверяем наличие файла бэкапа
BACKUP_FILE="./all_databases_20250605_111645.sql"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Файл $BACKUP_FILE не найден" | tee -a $LOG_FILE
    echo "Пожалуйста, скопируйте файл all_databases_20250605_111645.sql в текущую директорию" | tee -a $LOG_FILE
    exit 1
fi

echo "✅ Найден файл бэкапа: $(du -h $BACKUP_FILE | cut -f1)" | tee -a $LOG_FILE

# Остановка сервисов
echo "⏹️ Остановка сервисов..." | tee -a $LOG_FILE
docker-compose stop 2>&1 | tee -a $LOG_FILE

# Запуск PostgreSQL
echo "🚀 Запуск PostgreSQL..." | tee -a $LOG_FILE
docker-compose up -d postgres 2>&1 | tee -a $LOG_FILE

sleep 15

# Проверка PostgreSQL
echo "🔍 Проверка PostgreSQL..." | tee -a $LOG_FILE
docker exec root-postgres-1 pg_isready -U postgres 2>&1 | tee -a $LOG_FILE

# Создание временной базы для полного восстановления
echo "🗄️ Создание временной базы..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS temp_restore;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Восстановление полного бэкапа во временную базу
echo "📥 Восстановление полного бэкапа (это займет время)..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d temp_restore < $BACKUP_FILE 2>&1 | tee -a $LOG_FILE

RESTORE_STATUS=$?
if [ $RESTORE_STATUS -ne 0 ]; then
    echo "❌ Ошибка при восстановлении бэкапа" | tee -a $LOG_FILE
    exit 1
fi

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

echo "📊 Размер экспортированного файла: $(wc -l < ./directus_production.sql) строк" | tee -a $LOG_FILE

# Пересоздание базы directus
echo "🗄️ Пересоздание базы directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;" 2>&1 | tee -a $LOG_FILE

# Восстановление в базу directus
echo "📥 Восстановление в directus..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d directus < ./directus_production.sql 2>&1 | tee -a $LOG_FILE

# Удаление временной базы
echo "🗑️ Удаление временной базы..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Запуск всех сервисов
echo "🚀 Запуск всех сервисов..." | tee -a $LOG_FILE
docker-compose up -d 2>&1 | tee -a $LOG_FILE

sleep 20

echo "✅ Восстановление завершено!" | tee -a $LOG_FILE
echo "📝 Подробный лог: $LOG_FILE" | tee -a $LOG_FILE

# Проверка восстановленных данных
echo "🔍 Проверка восстановленных данных..." | tee -a $LOG_FILE
sleep 5
node check_database_structure.js 2>&1 | tee -a $LOG_FILE