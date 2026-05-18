#!/bin/bash

set -e

# Настройки серверов
OLD_SERVER="45.130.212.62"
NEW_SERVER="31.128.43.113"
OLD_SERVER_USER="root"
NEW_SERVER_USER="root"

echo "🚀 Миграция Directus с $OLD_SERVER на $NEW_SERVER"

# 1. Создать дампы на старом сервере
echo "📥 Создание дампов на старом сервере..."
ssh -T $OLD_SERVER_USER@$OLD_SERVER "cd ~/smm && docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') pg_dump -h localhost -p 5432 -U postgres -d directus --schema-only --no-owner --no-privileges > directus_schema_export.sql"

ssh -T $OLD_SERVER_USER@$OLD_SERVER "cd ~/smm && docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') pg_dump -h localhost -p 5432 -U postgres -d directus --table=directus_policies --table=directus_roles --table=directus_permissions --table=directus_users --data-only --no-owner --no-privileges --column-inserts > directus_auth_export.sql"

ssh -T $OLD_SERVER_USER@$OLD_SERVER "cd ~/smm && docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') pg_dump -h localhost -p 5432 -U postgres -d directus --table=business_questionnaire --table=campaign_content --table=campaign_content_sources --table=campaign_keywords --table=campaign_trend_topics --table=global_api_keys --table=post_comment --table=source_posts --table=user_api_keys --table=user_campaigns --table=user_keywords_user_campaigns --data-only --no-owner --no-privileges --column-inserts > directus_user_data_export.sql"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ssh -T $OLD_SERVER_USER@$OLD_SERVER "cd ~/smm && tar -czf directus_migration_$TIMESTAMP.tar.gz directus_*_export.sql && ls -lh directus_migration_*.tar.gz"

# 2. Скопировать архив на новый сервер
echo "📤 Копирование архива на новый сервер..."
ARCHIVE_NAME=$(ssh $OLD_SERVER_USER@$OLD_SERVER "cd ~/smm && ls -t directus_migration_*.tar.gz | head -1")
scp $OLD_SERVER_USER@$OLD_SERVER:~/smm/$ARCHIVE_NAME /tmp/

echo "📦 Передача архива на новый сервер..."
scp /tmp/$ARCHIVE_NAME $NEW_SERVER_USER@$NEW_SERVER:/root/

# 3. Восстановить данные на новом сервере
echo "🔄 Восстановление данных на новом сервере..."
ssh $NEW_SERVER_USER@$NEW_SERVER << REMOTE_RESTORE
cd /root

echo "Распаковка архива..."
tar -xzf $ARCHIVE_NAME

echo "Остановка Directus..."
docker-compose stop directus 2>/dev/null || true

echo "Пересоздание базы данных..."
docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') psql -U postgres << 'PSQL_SCRIPT'
DROP DATABASE IF EXISTS directus;
CREATE DATABASE directus;
GRANT ALL PRIVILEGES ON DATABASE directus TO postgres;
PSQL_SCRIPT

echo "Восстановление схемы..."
docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') psql -U postgres -d directus < directus_schema_export.sql

echo "Восстановление пользователей и ролей..."
docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') psql -U postgres -d directus < directus_auth_export.sql

echo "Восстановление пользовательских данных..."
docker exec -i \$(docker ps | grep postgres | awk '{print \$1}') psql -U postgres -d directus < directus_user_data_export.sql

echo "Запуск Directus..."
docker-compose up -d directus

echo "Ожидание запуска..."
sleep 10

echo "Проверка логов Directus..."
docker-compose logs directus --tail 20

echo "✅ Миграция завершена!"
echo "🌐 Directus доступен по адресу: https://directus.roboflow.tech"
REMOTE_RESTORE

echo "🎉 Миграция Directus завершена успешно!"
echo "Можете входить в Directus с теми же учетными данными что были на старом сервере"