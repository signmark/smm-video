#!/bin/bash
# Скрипт для копирования локальных модулей AWS SDK на сервер

# Создаем директории для модулей
echo "Создание директорий для модулей AWS SDK..."
mkdir -p /app/node_modules/@aws-sdk/client-s3
mkdir -p /app/node_modules/@aws-sdk/s3-request-presigner
mkdir -p /app/node_modules/@aws-sdk/lib-storage

# Копируем модули из локальной директории
echo "Копирование модулей из ./custom_modules/ в node_modules/..."
cp -r ./custom_modules/@aws-sdk/client-s3/* /app/node_modules/@aws-sdk/client-s3/
cp -r ./custom_modules/@aws-sdk/s3-request-presigner/* /app/node_modules/@aws-sdk/s3-request-presigner/
cp -r ./custom_modules/@aws-sdk/lib-storage/* /app/node_modules/@aws-sdk/lib-storage/

# Проверяем результат копирования
echo "Проверка результата копирования..."
ls -la /app/node_modules/@aws-sdk/client-s3/
ls -la /app/node_modules/@aws-sdk/s3-request-presigner/
ls -la /app/node_modules/@aws-sdk/lib-storage/

echo "Копирование завершено!"