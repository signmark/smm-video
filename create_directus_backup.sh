#!/bin/bash

set -e

echo "🚀 Создание резервной копии Directus"

cd ~/smm

echo "Создание дампа схемы..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_schema_export.sql

echo "Создание дампа системы авторизации..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus \
  --table=directus_policies \
  --table=directus_roles \
  --table=directus_permissions \
  --table=directus_users \
  --data-only --no-owner --no-privileges --column-inserts > directus_auth_export.sql

echo "Создание дампа пользовательских таблиц..."
docker exec -i $(docker ps | grep postgres | awk '{print $1}') pg_dump -h localhost -p 5432 -U postgres -d directus \
  --table=business_questionnaire \
  --table=campaign_content \
  --table=campaign_content_sources \
  --table=campaign_keywords \
  --table=campaign_trend_topics \
  --table=global_api_keys \
  --table=post_comment \
  --table=source_posts \
  --table=user_api_keys \
  --table=user_campaigns \
  --table=user_keywords_user_campaigns \
  --data-only --no-owner --no-privileges --column-inserts > directus_user_data_export.sql

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo "Создание архива..."
tar -czf directus_migration_$TIMESTAMP.tar.gz directus_*_export.sql

echo "✅ Резервная копия создана:"
ls -lh directus_migration_*.tar.gz

echo "📋 Теперь скопируйте этот файл на новый сервер командой:"
echo "scp directus_migration_$TIMESTAMP.tar.gz root@31.128.43.113:/root/"