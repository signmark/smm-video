#!/bin/bash

LOG_FILE="/root/production_restore_$(date +%Y%m%d_%H%M%S).log"

echo "🔄 Скачивание и восстановление продакшен бэкапа" | tee -a $LOG_FILE

# Создаем папку для бэкапов если её нет
mkdir -p /root/backup

# Скачиваем бэкап с продакшена
echo "📥 Скачивание бэкапа all_databases_20250605_111645.sql..." | tee -a $LOG_FILE
scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql /root/backup/ 2>&1 | tee -a $LOG_FILE

if [ ! -f "/root/backup/all_databases_20250605_111645.sql" ]; then
    echo "❌ Не удалось скачать файл бэкапа" | tee -a $LOG_FILE
    echo "Попробуем альтернативный способ..." | tee -a $LOG_FILE
    
    # Альтернативный способ через rsync
    rsync -avz root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql /root/backup/ 2>&1 | tee -a $LOG_FILE
    
    if [ ! -f "/root/backup/all_databases_20250605_111645.sql" ]; then
        echo "❌ Альтернативный способ тоже не сработал" | tee -a $LOG_FILE
        exit 1
    fi
fi

echo "✅ Файл скачан, размер: $(du -h /root/backup/all_databases_20250605_111645.sql | cut -f1)" | tee -a $LOG_FILE

cd /root

# Остановка сервисов
echo "⏹️ Остановка всех сервисов..." | tee -a $LOG_FILE
docker-compose stop 2>&1 | tee -a $LOG_FILE

# Запуск PostgreSQL
echo "🚀 Запуск PostgreSQL..." | tee -a $LOG_FILE
docker-compose up -d postgres 2>&1 | tee -a $LOG_FILE

sleep 15

# Проверка статуса PostgreSQL
echo "🔍 Проверка статуса PostgreSQL..." | tee -a $LOG_FILE
docker exec root-postgres-1 pg_isready -U postgres 2>&1 | tee -a $LOG_FILE

# Создание временной базы для восстановления
echo "🗄️ Создание временной базы для восстановления..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS temp_restore;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Восстановление полного бэкапа в временную базу
echo "📥 Восстановление полного бэкапа в временную базу..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d temp_restore < /root/backup/all_databases_20250605_111645.sql 2>&1 | tee -a $LOG_FILE

# Экспорт только данных Directus из временной базы
echo "📤 Экспорт данных Directus из временной базы..." | tee -a $LOG_FILE
DIRECTUS_BACKUP="/tmp/directus_production_backup.sql"

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
    > $DIRECTUS_BACKUP 2>&1 | tee -a $LOG_FILE

echo "📊 Размер экспортированного файла: $(wc -l < $DIRECTUS_BACKUP) строк" | tee -a $LOG_FILE

# Удаление временной базы
echo "🗑️ Удаление временной базы..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE

# Пересоздание базы directus
echo "🗄️ Пересоздание базы данных directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;" 2>&1 | tee -a $LOG_FILE

# Восстановление данных Directus
echo "📥 Восстановление данных Directus..." | tee -a $LOG_FILE
docker exec -i root-postgres-1 psql -U postgres -d directus < $DIRECTUS_BACKUP 2>&1 | tee -a $LOG_FILE

# Очистка временного файла
rm -f $DIRECTUS_BACKUP

# Запуск Directus
echo "🚀 Запуск Directus..." | tee -a $LOG_FILE
docker-compose up -d directus 2>&1 | tee -a $LOG_FILE

sleep 15

# Запуск всех сервисов
echo "🚀 Запуск всех сервисов..." | tee -a $LOG_FILE
docker-compose up -d 2>&1 | tee -a $LOG_FILE

echo "✅ Восстановление из продакшен бэкапа завершено!" | tee -a $LOG_FILE
echo "📝 Лог сохранен в: $LOG_FILE" | tee -a $LOG_FILE

# Проверка восстановленных данных
echo "🔍 Проверка восстановленных данных..." | tee -a $LOG_FILE
sleep 10

# Запуск проверки структуры базы
echo "📊 Запуск проверки структуры базы данных..." | tee -a $LOG_FILE
node check_database_structure.js 2>&1 | tee -a $LOG_FILE