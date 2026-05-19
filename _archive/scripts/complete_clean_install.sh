#!/bin/bash

set -e

echo "Полная очистка и пересоздание базы данных"

# Остановка всех сервисов
docker-compose down -v

# Удаление всех томов Docker
echo "Удаление Docker томов..."
docker volume prune -f
docker system prune -f

# Полная очистка данных
echo "Удаление всех данных..."
rm -rf postgres directus_data n8n_data pgladmin_data uploads logs

# Создание новых директорий
mkdir -p postgres directus_data n8n_data pgladmin_data uploads logs
chmod 755 postgres directus_data n8n_data pgladmin_data uploads logs

# Запуск только PostgreSQL
echo "Запуск PostgreSQL..."
docker-compose up -d postgres

# Ожидание запуска PostgreSQL
echo "Ожидание запуска PostgreSQL..."
sleep 20

# Проверка что PostgreSQL работает
echo "Проверка PostgreSQL..."
docker exec $(docker ps | grep postgres | awk '{print $1}') pg_isready -U postgres

# Создание базы данных directus (если не существует)
echo "Создание базы данных directus..."
docker exec $(docker ps | grep postgres | awk '{print $1}') createdb -U postgres directus 2>/dev/null || echo "База directus уже существует"

# Запуск Directus
echo "Запуск Directus..."
docker-compose up -d directus

# Ожидание полной инициализации Directus
echo "Ожидание инициализации Directus (90 секунд)..."
sleep 90

# Проверка статуса
echo "Проверка статуса сервисов:"
docker-compose ps

echo "Последние логи Directus:"
docker-compose logs directus --tail 20

echo "Проверка доступности Directus:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://directus.roboflow.tech/ || echo "Directus еще запускается"

echo ""
echo "✅ Установка завершена!"
echo "Directus доступен на: https://directus.roboflow.tech"
echo "Данные для входа: admin@roboflow.tech / admin123456"