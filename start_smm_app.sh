#!/bin/bash

echo "Запуск SMM приложения"

# Проверка что Directus работает
echo "Проверка Directus..."
curl -s -o /dev/null -w "Directus HTTP Status: %{http_code}\n" https://directus.roboflow.tech/

# Запуск SMM приложения
echo "Запуск SMM контейнера..."
docker-compose up -d smm

# Ожидание запуска
echo "Ожидание запуска SMM приложения (30 секунд)..."
sleep 30

# Проверка статуса
echo "Проверка статуса контейнеров:"
docker-compose ps

# Проверка логов SMM
echo "Последние логи SMM:"
docker-compose logs smm --tail 20

# Проверка доступности SMM приложения
echo "Проверка доступности SMM приложения:"
curl -s -o /dev/null -w "SMM HTTP Status: %{http_code}\n" https://smm.roboflow.tech/ || echo "SMM приложение еще запускается"

echo ""
echo "SMM приложение должно быть доступно на:"
echo "https://smm.roboflow.tech"
echo ""
echo "Данные для входа:"
echo "signmark@gmail.com / password123"
echo "lbrspb@gmail.com / password123 (SMM админ)"