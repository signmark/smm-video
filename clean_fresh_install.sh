#!/bin/bash

set -e

echo "Полная очистка и свежая установка Directus"

# Остановка всех сервисов
docker-compose down

# Полная очистка данных
echo "Удаление старых данных..."
rm -rf postgres directus_data n8n_data pgladmin_data

# Создание новых директорий
mkdir -p postgres directus_data n8n_data pgladmin_data uploads logs
chmod 755 postgres directus_data n8n_data pgladmin_data

# Запуск PostgreSQL
echo "Запуск PostgreSQL..."
docker-compose up -d postgres

# Ожидание запуска PostgreSQL
sleep 15

# Запуск Directus с чистой инициализацией
echo "Запуск Directus..."
docker-compose up -d directus

# Ожидание полной инициализации
echo "Ожидание инициализации Directus (60 секунд)..."
sleep 60

# Проверка статуса
echo "Проверка статуса:"
docker-compose ps

echo "Проверка логов Directus:"
docker-compose logs directus --tail 10

echo "Проверка доступности:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://directus.roboflow.tech/ || echo "Directus еще запускается"

echo ""
echo "Готово! Directus должен быть доступен на:"
echo "https://directus.roboflow.tech"
echo ""
echo "Данные для входа:"
echo "Email: admin@roboflow.tech"
echo "Password: (пароль из docker-compose.yml)"