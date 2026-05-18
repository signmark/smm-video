#!/bin/bash

set -e

echo "🚀 Развертывание SMM системы из корневой директории на roboflow.tech"

# Остановить систему в /opt/smm-system если она запущена
if [ -d "/opt/smm-system" ]; then
    echo "📍 Остановка системы в /opt/smm-system..."
    cd /opt/smm-system
    docker-compose down 2>/dev/null || true
fi

# Перейти в корневую директорию
cd /root

echo "📍 Работаем из директории: $(pwd)"

# Копировать настройки для roboflow.tech
echo "⚙️ Настройка конфигурации для roboflow.tech..."
cp .env.roboflow .env

# Обновить docker-compose.yml для новых доменов
echo "🔧 Обновление docker-compose.yml..."
sed -i 's/smm\.nplanner\.ru/smm.roboflow.tech/g' docker-compose.yml
sed -i 's/directus\.nplanner\.ru/directus.roboflow.tech/g' docker-compose.yml
sed -i 's/n8n\.nplanner\.ru/n8n.roboflow.tech/g' docker-compose.yml
sed -i 's/pgladmin\.nplanner\.ru/pgladmin.roboflow.tech/g' docker-compose.yml

# Заменить переменные на конкретные домены в Traefik конфигурации
sed -i 's/Host(`${PGLADMIN_SUBDOMAIN}\.${DOMAIN_NAME}`)/Host(`pgladmin.roboflow.tech`)/g' docker-compose.yml
sed -i 's/Host(`directus\.${DOMAIN_NAME}`)/Host(`directus.roboflow.tech`)/g' docker-compose.yml

# Убрать устаревший атрибут version
sed -i '/^version:/d' docker-compose.yml

echo "🔍 Проверка DNS записей..."
nslookup smm.roboflow.tech || echo "⚠️ DNS запись для smm.roboflow.tech еще не распространилась"
nslookup directus.roboflow.tech || echo "⚠️ DNS запись для directus.roboflow.tech еще не распространилась"

echo "🐳 Запуск Docker контейнеров..."
docker-compose up -d --build

echo "⏳ Ожидание запуска сервисов..."
sleep 30

echo "📊 Статус контейнеров:"
docker-compose ps

echo "🔍 Логи SMM контейнера:"
docker-compose logs smm --tail 20

echo "✅ Развертывание завершено!"
echo "🌐 Сервисы доступны по адресам:"
echo "   - SMM: https://smm.roboflow.tech"
echo "   - Directus: https://directus.roboflow.tech"
echo "   - N8N: https://n8n.roboflow.tech"
echo "   - PgAdmin: https://pgladmin.roboflow.tech"
echo ""
echo "⚠️ Примечание: SSL сертификаты могут потребовать время для получения"