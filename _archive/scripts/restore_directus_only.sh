#!/bin/bash

LOG_FILE="/root/restore_directus_only_$(date +%Y%m%d_%H%M%S).log"

echo "🔄 Восстановление только базы данных Directus" | tee -a $LOG_FILE

cd /root

# Остановка сервисов
echo "⏹️ Остановка всех сервисов..." | tee -a $LOG_FILE
docker-compose stop 2>&1 | tee -a $LOG_FILE

# Запуск PostgreSQL
echo "🚀 Запуск PostgreSQL..." | tee -a $LOG_FILE
docker-compose up -d postgres 2>&1 | tee -a $LOG_FILE

sleep 15

# Удаление и создание базы данных Directus
echo "🗄️ Пересоздание базы данных directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;" 2>&1 | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;" 2>&1 | tee -a $LOG_FILE

# Извлечение только данных Directus из полного бэкапа
echo "📥 Извлечение данных Directus из бэкапа..." | tee -a $LOG_FILE

# Создаем временный файл только с данными Directus
DIRECTUS_BACKUP="/tmp/directus_only_backup.sql"

# Извлекаем данные для базы directus из полного бэкапа
echo "\\connect directus" > $DIRECTUS_BACKUP
grep -A 999999 "\\connect directus" /root/backup/all_databases_20250606_020001.sql | \
grep -B 999999 "\\connect postgres\|\\connect n8n\|^--$" | \
head -n -2 >> $DIRECTUS_BACKUP

# Если файл получился слишком маленький, попробуем другой подход
if [ $(wc -l < $DIRECTUS_BACKUP) -lt 10 ]; then
    echo "⚠️ Первый способ не сработал, пробуем извлечь по-другому..." | tee -a $LOG_FILE
    
    # Альтернативный способ - ищем секцию с данными directus
    sed -n '/PostgreSQL database dump complete/,$p' /root/backup/all_databases_20250606_020001.sql | \
    sed -n '/Name: directus; Type: DATABASE/,/PostgreSQL database dump complete/p' > $DIRECTUS_BACKUP
fi

echo "📊 Размер извлеченного файла: $(wc -l < $DIRECTUS_BACKUP) строк" | tee -a $LOG_FILE

if [ $(wc -l < $DIRECTUS_BACKUP) -lt 5 ]; then
    echo "❌ Не удалось извлечь данные Directus из бэкапа" | tee -a $LOG_FILE
    echo "Попробуем восстановить весь дамп в отдельную базу и затем экспортировать directus..." | tee -a $LOG_FILE
    
    # Создаем временную базу для восстановления
    docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS temp_restore;" 2>&1 | tee -a $LOG_FILE
    docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE
    
    # Восстанавливаем в временную базу
    echo "📥 Восстановление в временную базу..." | tee -a $LOG_FILE
    docker exec -i root-postgres-1 psql -U postgres -d temp_restore < /root/backup/all_databases_20250606_020001.sql 2>&1 | tee -a $LOG_FILE
    
    # Экспортируем только directus
    echo "📤 Экспорт данных directus..." | tee -a $LOG_FILE
    docker exec root-postgres-1 pg_dump -U postgres -d temp_restore --schema=public -t "directus_*" -t "business_questionnaire" -t "campaign_*" -t "user_*" -t "global_api_keys" > $DIRECTUS_BACKUP
    
    # Удаляем временную базу
    docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE temp_restore;" 2>&1 | tee -a $LOG_FILE
fi

# Восстановление в базу directus
echo "📥 Восстановление данных в базу directus..." | tee -a $LOG_FILE
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

echo "✅ Восстановление завершено!" | tee -a $LOG_FILE
echo "📝 Лог сохранен в: $LOG_FILE" | tee -a $LOG_FILE