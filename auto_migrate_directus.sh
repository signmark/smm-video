#!/bin/bash

set -e

OLD_SERVER="45.130.212.62"
NEW_SERVER="31.128.43.113"

echo "Автоматическая миграция Directus с $OLD_SERVER на $NEW_SERVER"

# Проверка SSH доступа
echo "Проверка SSH доступа к старому серверу..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes root@$OLD_SERVER exit 2>/dev/null; then
    echo "Ошибка: Нет SSH доступа к старому серверу $OLD_SERVER"
    echo "Убедитесь что SSH ключи настроены правильно"
    exit 1
fi

echo "SSH доступ к старому серверу работает"

# Создание дампов на старом сервере
echo "Создание полных дампов на старом сервере..."
ssh root@$OLD_SERVER << 'REMOTE_COMMANDS'
cd ~/smm
echo "Создание полного дампа схемы..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_full_schema.sql

echo "Создание полного дампа данных..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --data-only --no-owner --no-privileges --column-inserts > directus_full_data.sql

echo "Создание архива..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
tar -czf directus_complete_$TIMESTAMP.tar.gz directus_full_*.sql

echo "Дампы созданы:"
ls -lh directus_complete_*.tar.gz
REMOTE_COMMANDS

# Получение имени архива
echo "Получение архива с старого сервера..."
ARCHIVE_NAME=$(ssh root@$OLD_SERVER "cd ~/smm && ls -t directus_complete_*.tar.gz | head -1")
echo "Архив: $ARCHIVE_NAME"

# Копирование архива
scp root@$OLD_SERVER:~/smm/$ARCHIVE_NAME ./

echo "Архив скопирован: $ARCHIVE_NAME"

# Создание новой базы данных
echo "Создание новой базы данных directus..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres << 'PSQL_SCRIPT'
DROP DATABASE IF EXISTS directus;
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

# Распаковка и восстановление
echo "Распаковка архива..."
tar -xzf "$ARCHIVE_NAME"

echo "Восстановление схемы..."
if [ -f "directus_full_schema.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_schema.sql
    echo "✓ Схема восстановлена"
else
    echo "✗ Файл схемы не найден!"
    exit 1
fi

echo "Восстановление данных..."
if [ -f "directus_full_data.sql" ]; then
    docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus < directus_full_data.sql
    echo "✓ Данные восстановлены"
else
    echo "✗ Файл данных не найден!"
    exit 1
fi

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска Directus..."
sleep 25

echo "Проверка пользователей в базе:"
docker exec -i $(docker ps | grep postgres | awk '{print $1}') psql -U postgres -d directus -c "SELECT email, first_name, last_name, status FROM directus_users ORDER BY email;"

echo "Проверка логов Directus:"
docker-compose logs directus --tail 15

echo ""
echo "✅ Миграция завершена!"
echo "🌐 Directus доступен: https://directus.roboflow.tech"
echo "👤 Войдите с учетными данными со старого сервера"

# Очистка временных файлов
rm -f directus_full_*.sql
echo "Временные файлы очищены"