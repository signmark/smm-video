#!/bin/bash

set -e

echo "🗄️ Создание полного бэкапа данных Directus"

# Настройки подключения к базе данных
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="postgres"
POSTGRES_DB="directus"
POSTGRES_PASSWORD="QtpZ3dh7"

# Список важных таблиц для бэкапа
IMPORTANT_TABLES=(
    business_questionnaire
    campaign_content
    campaign_content_sources
    campaign_keywords
    campaign_trend_topics
    global_api_keys
    post_comment
    source_posts
    user_api_keys
    user_campaigns
    user_keywords_user_campaigns
    directus_users
    directus_roles
    directus_permissions
    directus_settings
    directus_collections
    directus_fields
    directus_relations
)

# Создать директорию для бэкапов
BACKUP_DIR="/root/directus_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📍 Бэкап будет сохранен в: $BACKUP_DIR"

# Экспорт полной схемы и данных
echo "📥 Экспорт полной базы данных..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --verbose \
  --no-password \
  --format=custom \
  --file="$BACKUP_DIR/full_database.dump"

# Экспорт в формате SQL для читаемости
echo "📥 Экспорт в SQL формате..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --verbose \
  --no-password \
  --file="$BACKUP_DIR/full_database.sql"

# Экспорт только данных (без схемы)
echo "📥 Экспорт только данных..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --verbose \
  --no-password \
  --data-only \
  --file="$BACKUP_DIR/data_only.sql"

# Экспорт только схемы
echo "📥 Экспорт только схемы..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --verbose \
  --no-password \
  --schema-only \
  --file="$BACKUP_DIR/schema_only.sql"

# Экспорт конкретных важных таблиц
echo "📥 Экспорт важных таблиц..."
mkdir -p "$BACKUP_DIR/individual_tables"

for table in "${IMPORTANT_TABLES[@]}"; do
    echo "  Экспорт таблицы: $table"
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
      -h "$POSTGRES_HOST" \
      -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --verbose \
      --no-password \
      --data-only \
      --table="$table" \
      --file="$BACKUP_DIR/individual_tables/${table}.sql" 2>/dev/null || echo "    Таблица $table не найдена"
done

# Объединить все важные таблицы в один файл
echo "📦 Объединение данных важных таблиц..."
cat "$BACKUP_DIR/individual_tables"/*.sql > "$BACKUP_DIR/important_tables_data.sql" 2>/dev/null || echo "Некоторые таблицы отсутствуют"

# Проверка содержимого важных таблиц
echo "📊 Проверка содержимого таблиц..."
cat > "$BACKUP_DIR/table_stats.txt" << EOF
Статистика таблиц на $(date)
================================

EOF

for table in "${IMPORTANT_TABLES[@]}"; do
    echo "Проверка таблицы: $table"
    ROW_COUNT=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    echo "$table: $(echo $ROW_COUNT | xargs) записей" >> "$BACKUP_DIR/table_stats.txt"
done

# Создать информационный файл
echo "📝 Создание информационного файла..."
cat > "$BACKUP_DIR/backup_info.txt" << EOF
Бэкап базы данных Directus SMM Manager
=====================================

Дата создания: $(date)
Сервер: $(hostname)
База данных: $POSTGRES_DB
Пользователь: $POSTGRES_USER

Файлы бэкапа:
- full_database.dump - полный бэкап в формате PostgreSQL (рекомендуемый для восстановления)
- full_database.sql - полный бэкап в SQL формате (читаемый)
- data_only.sql - только данные без схемы
- schema_only.sql - только структура без данных
- important_tables_data.sql - данные важных таблиц SMM системы
- table_stats.txt - статистика по количеству записей в таблицах

Важные таблицы включают:
- business_questionnaire
- campaign_content
- campaign_content_sources
- campaign_keywords
- campaign_trend_topics
- global_api_keys
- post_comment
- source_posts
- user_api_keys
- user_campaigns
- user_keywords_user_campaigns
- directus_users
- directus_roles
- directus_permissions
- directus_settings
- directus_collections
- directus_fields
- directus_relations

Для восстановления на новом сервере используйте:
pg_restore -h localhost -p 5432 -U postgres -d directus --verbose --clean --if-exists full_database.dump

Или в SQL формате:
psql -h localhost -p 5432 -U postgres -d directus < full_database.sql
EOF

# Проверить размеры файлов
echo "📊 Размеры созданных файлов:"
ls -lh "$BACKUP_DIR"

# Создать архив
echo "📦 Создание архива..."
cd /root
tar -czf "directus_backup_$(date +%Y%m%d_%H%M%S).tar.gz" "$(basename $BACKUP_DIR)"

echo "✅ Бэкап завершен!"
echo "📁 Директория бэкапа: $BACKUP_DIR"
echo "📦 Архив: /root/directus_backup_$(date +%Y%m%d_%H%M%S).tar.gz"
echo ""
echo "🚚 Для переноса на новый сервер:"
echo "1. Скопируйте архив на новый сервер"
echo "2. Распакуйте: tar -xzf directus_backup_*.tar.gz"
echo "3. Восстановите базу данных используя файл full_database.dump"