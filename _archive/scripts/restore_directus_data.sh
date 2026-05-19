#!/bin/bash

set -e

echo "🔄 Восстановление данных Directus на новом сервере"

# Проверить аргументы
if [ $# -eq 0 ]; then
    echo "❌ Использование: $0 <путь_к_файлу_бэкапа>"
    echo "Примеры:"
    echo "  $0 /root/directus_backup_20250605/full_database.dump"
    echo "  $0 /root/directus_backup_20250605/full_database.sql"
    exit 1
fi

BACKUP_FILE="$1"

# Проверить существование файла
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Файл бэкапа не найден: $BACKUP_FILE"
    exit 1
fi

# Настройки подключения к базе данных
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="postgres"
POSTGRES_DB="directus"
POSTGRES_PASSWORD="QtpZ3dh7"

echo "📍 Восстановление из файла: $BACKUP_FILE"
echo "📍 База данных: $POSTGRES_DB"

# Остановить Directus если запущен
echo "⏹️ Остановка Directus контейнера..."
docker-compose stop directus 2>/dev/null || true

# Подождать завершения операций
sleep 5

# Проверить подключение к базе данных
echo "🔍 Проверка подключения к базе данных..."
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d postgres -c "SELECT 1;" > /dev/null

# Удалить существующую базу данных и создать заново
echo "🗑️ Пересоздание базы данных..."
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d postgres << EOF
DROP DATABASE IF EXISTS $POSTGRES_DB;
CREATE DATABASE $POSTGRES_DB;
GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
EOF

# Определить формат файла и восстановить
echo "📥 Восстановление данных..."
if [[ "$BACKUP_FILE" == *.dump ]]; then
    echo "🔧 Восстановление из .dump файла..."
    PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --verbose \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        "$BACKUP_FILE"
elif [[ "$BACKUP_FILE" == *.sql ]]; then
    echo "🔧 Восстановление из .sql файла..."
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -f "$BACKUP_FILE"
else
    echo "❌ Неподдерживаемый формат файла. Используйте .dump или .sql"
    exit 1
fi

# Проверить успешность восстановления
echo "✅ Проверка восстановленных данных..."
TABLE_COUNT=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "📊 Восстановлено таблиц: $(echo $TABLE_COUNT | xargs)"

# Показать список основных таблиц
echo "📋 Восстановленные таблицы SMM системы:"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT table_name, 
       (SELECT COUNT(*) FROM \"$table_name\") as records,
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as columns
FROM information_schema.tables t 
WHERE table_schema = 'public' 
  AND table_name IN (
    'business_questionnaire',
    'campaign_content', 
    'campaign_content_sources',
    'campaign_keywords',
    'campaign_trend_topics',
    'global_api_keys',
    'post_comment',
    'source_posts',
    'user_api_keys',
    'user_campaigns',
    'user_keywords_user_campaigns',
    'directus_users',
    'directus_roles',
    'directus_permissions'
  )
ORDER BY table_name;
"

# Запустить Directus обратно
echo "▶️ Запуск Directus контейнера..."
docker-compose up -d directus

echo "⏳ Ожидание запуска Directus..."
sleep 15

# Проверить статус Directus
echo "🔍 Проверка статуса Directus..."
docker-compose logs directus --tail 10

echo "✅ Восстановление завершено!"
echo "🌐 Directus должен быть доступен по адресу: https://directus.roboflow.tech"
echo ""
echo "🔑 Данные для входа администратора должны быть такими же, как на старом сервере"
echo "📧 Email: admin@roboflow.tech (если был создан) или ваш существующий admin email"