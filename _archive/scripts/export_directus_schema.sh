#!/bin/bash

set -e

echo "📋 Экспорт схемы коллекций Directus (без данных)"

# Настройки подключения к базе данных
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="postgres"
POSTGRES_DB="directus"
POSTGRES_PASSWORD="QtpZ3dh7"

# Создать директорию для схемы
SCHEMA_DIR="/root/directus_schema_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$SCHEMA_DIR"

echo "Схема будет сохранена в: $SCHEMA_DIR"

# Экспорт структуры системных таблиц Directus
echo "Экспорт системных таблиц Directus..."
DIRECTUS_SYSTEM_TABLES=(
    directus_collections
    directus_fields
    directus_relations
    directus_permissions
    directus_roles
    directus_users
    directus_settings
    directus_flows
    directus_operations
    directus_panels
    directus_dashboards
    directus_presets
    directus_activity
    directus_notifications
    directus_shares
    directus_files
    directus_folders
    directus_translations
    directus_webhooks
    directus_revisions
)

# Экспорт пользовательских таблиц
echo "Экспорт пользовательских таблиц..."
USER_TABLES=(
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
)

# Экспорт полной схемы базы данных
echo "Создание полной схемы..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file="$SCHEMA_DIR/full_schema.sql"

# Экспорт только системных таблиц Directus
echo "Создание схемы системных таблиц Directus..."
for table in "${DIRECTUS_SYSTEM_TABLES[@]}"; do
    echo "  Экспорт структуры: $table"
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
      -h "$POSTGRES_HOST" \
      -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --schema-only \
      --no-owner \
      --no-privileges \
      --table="$table" \
      --file="$SCHEMA_DIR/system_${table}.sql" 2>/dev/null || echo "    Таблица $table не найдена"
done

# Экспорт только пользовательских таблиц
echo "Создание схемы пользовательских таблиц..."
for table in "${USER_TABLES[@]}"; do
    echo "  Экспорт структуры: $table"
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
      -h "$POSTGRES_HOST" \
      -p "$POSTGRES_PORT" \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      --schema-only \
      --no-owner \
      --no-privileges \
      --table="$table" \
      --file="$SCHEMA_DIR/user_${table}.sql" 2>/dev/null || echo "    Таблица $table не найдена"
done

# Создание объединенных файлов
echo "Создание объединенных схем..."
cat "$SCHEMA_DIR"/system_*.sql > "$SCHEMA_DIR/directus_system_schema.sql" 2>/dev/null || touch "$SCHEMA_DIR/directus_system_schema.sql"
cat "$SCHEMA_DIR"/user_*.sql > "$SCHEMA_DIR/user_tables_schema.sql" 2>/dev/null || touch "$SCHEMA_DIR/user_tables_schema.sql"

# Создание информационного файла
cat > "$SCHEMA_DIR/schema_info.txt" << EOF
Экспорт схемы Directus
=====================

Дата создания: $(date)
Сервер: $(hostname)
База данных: $POSTGRES_DB

Файлы схемы:
- full_schema.sql - полная схема всех таблиц
- directus_system_schema.sql - только системные таблицы Directus
- user_tables_schema.sql - только пользовательские таблицы
- system_*.sql - отдельные файлы системных таблиц
- user_*.sql - отдельные файлы пользовательских таблиц

Для создания структуры на новом сервере:
1. Создайте пустую базу данных
2. Выполните: psql -d directus < full_schema.sql

Или поэтапно:
1. psql -d directus < directus_system_schema.sql
2. psql -d directus < user_tables_schema.sql
EOF

# Создание скрипта импорта
cat > "$SCHEMA_DIR/import_schema.sh" << 'EOF'
#!/bin/bash

set -e

echo "Импорт схемы Directus на новый сервер"

POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_USER="postgres"
POSTGRES_DB="directus"
POSTGRES_PASSWORD="QtpZ3dh7"

# Проверить аргументы
if [ $# -eq 0 ]; then
    echo "Использование: $0 [full|system|user]"
    echo "  full   - импорт полной схемы"
    echo "  system - импорт только системных таблиц Directus"
    echo "  user   - импорт только пользовательских таблиц"
    exit 1
fi

IMPORT_TYPE="$1"

case $IMPORT_TYPE in
    "full")
        echo "Импорт полной схемы..."
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "full_schema.sql"
        ;;
    "system")
        echo "Импорт системных таблиц Directus..."
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "directus_system_schema.sql"
        ;;
    "user")
        echo "Импорт пользовательских таблиц..."
        PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "user_tables_schema.sql"
        ;;
    *)
        echo "Неизвестный тип импорта: $IMPORT_TYPE"
        exit 1
        ;;
esac

echo "Импорт завершен!"
EOF

chmod +x "$SCHEMA_DIR/import_schema.sh"

# Показать размеры файлов
echo "Размеры созданных файлов:"
ls -lh "$SCHEMA_DIR"

# Создать архив
echo "Создание архива схемы..."
cd /root
tar -czf "directus_schema_$(date +%Y%m%d_%H%M%S).tar.gz" "$(basename $SCHEMA_DIR)"

echo "Экспорт схемы завершен!"
echo "Директория: $SCHEMA_DIR"
echo "Архив: /root/directus_schema_$(date +%Y%m%d_%H%M%S).tar.gz"
echo ""
echo "На новом сервере для импорта схемы:"
echo "1. Распакуйте архив"
echo "2. Запустите: ./import_schema.sh full"