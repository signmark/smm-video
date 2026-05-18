#!/bin/bash

LOG_FILE="/root/restore_log_$(date +%Y%m%d_%H%M%S).log"

echo "🔄 Восстановление базы данных с детальным логированием" | tee -a $LOG_FILE
echo "📝 Логи сохраняются в: $LOG_FILE" | tee -a $LOG_FILE

cd /root

# Проверка существования бэкапа
BACKUP_FILE="/root/backup/all_databases_20250606_020001.sql"
echo "📦 Проверка бэкапа: $BACKUP_FILE" | tee -a $LOG_FILE
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Файл бэкапа не найден!" | tee -a $LOG_FILE
    echo "Доступные файлы в /root/backup/:" | tee -a $LOG_FILE
    ls -la /root/backup/ | tee -a $LOG_FILE
    exit 1
fi

echo "✅ Файл бэкапа найден, размер: $(du -h $BACKUP_FILE | cut -f1)" | tee -a $LOG_FILE

# Остановка сервисов
echo "⏹️ Остановка всех сервисов..." | tee -a $LOG_FILE
docker-compose stop 2>&1 | tee -a $LOG_FILE

# Запуск PostgreSQL
echo "🚀 Запуск PostgreSQL..." | tee -a $LOG_FILE
docker-compose up -d postgres 2>&1 | tee -a $LOG_FILE

# Проверка статуса PostgreSQL
echo "⏳ Ожидание запуска PostgreSQL (15 секунд)..." | tee -a $LOG_FILE
sleep 15

echo "🔍 Проверка статуса PostgreSQL..." | tee -a $LOG_FILE
docker exec root-postgres-1 pg_isready -U postgres 2>&1 | tee -a $LOG_FILE

# Проверка подключения к базе
echo "🔍 Проверка подключения к базе данных..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "SELECT version();" 2>&1 | tee -a $LOG_FILE

# Удаление старой базы
echo "🗄️ Удаление старой базы данных directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;" 2>&1 | tee -a $LOG_FILE

# Создание новой базы
echo "🗄️ Создание новой базы данных directus..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;" 2>&1 | tee -a $LOG_FILE

# Проверка что база создалась
echo "🔍 Проверка создания базы данных..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -c "\l" | grep directus 2>&1 | tee -a $LOG_FILE

# Восстановление из бэкапа
echo "📥 Начало восстановления данных из бэкапа..." | tee -a $LOG_FILE
echo "⚠️ Это может занять несколько минут, ждите..." | tee -a $LOG_FILE

# Попробуем восстановление с детальным выводом
docker exec -i root-postgres-1 psql -U postgres < $BACKUP_FILE 2>&1 | tee -a $LOG_FILE
RESTORE_STATUS=$?

if [ $RESTORE_STATUS -eq 0 ]; then
    echo "✅ Восстановление завершено успешно" | tee -a $LOG_FILE
else
    echo "❌ Ошибка при восстановлении (код: $RESTORE_STATUS)" | tee -a $LOG_FILE
    echo "Последние строки лога восстановления:" | tee -a $LOG_FILE
    tail -20 $LOG_FILE
    exit 1
fi

# Проверка восстановленных данных
echo "🔍 Проверка восстановленных данных..." | tee -a $LOG_FILE
docker exec root-postgres-1 psql -U postgres -d directus -c "SELECT count(*) FROM directus_users;" 2>&1 | tee -a $LOG_FILE

# Запуск Directus
echo "🚀 Запуск Directus..." | tee -a $LOG_FILE
docker-compose up -d directus 2>&1 | tee -a $LOG_FILE

sleep 15

# Запуск всех сервисов
echo "🚀 Запуск всех сервисов..." | tee -a $LOG_FILE
docker-compose up -d 2>&1 | tee -a $LOG_FILE

echo "✅ Процесс восстановления завершен!" | tee -a $LOG_FILE
echo "📋 Статус контейнеров:" | tee -a $LOG_FILE
docker-compose ps 2>&1 | tee -a $LOG_FILE

echo "" | tee -a $LOG_FILE
echo "📝 Полный лог сохранен в: $LOG_FILE" | tee -a $LOG_FILE