#!/bin/bash
# Скрипт для проверки работы локальных модулей AWS SDK в Docker

# Название образа
IMAGE_NAME="smm-app-local-aws-sdk"

echo "=== Проверка локальных модулей AWS SDK в Docker ==="

# Проверяем наличие папки custom_modules с AWS SDK
if [ ! -d "./custom_modules/@aws-sdk" ]; then
  echo "Ошибка: Папка ./custom_modules/@aws-sdk не найдена!"
  echo "Сначала выполните подготовку локальных модулей AWS SDK."
  exit 1
fi

# Проверяем наличие основных модулей
if [ ! -d "./custom_modules/@aws-sdk/client-s3" ] || [ ! -d "./custom_modules/@aws-sdk/s3-request-presigner" ]; then
  echo "Ошибка: Необходимые модули AWS SDK не найдены в ./custom_modules/@aws-sdk/"
  echo "Убедитесь, что модули client-s3 и s3-request-presigner существуют."
  exit 1
fi

echo "Локальные модули AWS SDK обнаружены..."

# Проверяем наличие тестового скрипта
if [ ! -f "./test-local-aws-sdk.js" ]; then
  echo "Ошибка: Тестовый скрипт test-local-aws-sdk.js не найден!"
  exit 1
fi

echo "Тестовый скрипт обнаружен..."

# Проверяем наличие Dockerfile.local-aws-sdk
if [ ! -f "./Dockerfile.local-aws-sdk" ]; then
  echo "Ошибка: Dockerfile.local-aws-sdk не найден!"
  exit 1
fi

echo "Dockerfile.local-aws-sdk обнаружен..."

# Собираем Docker образ
echo -e "\nСборка Docker образа $IMAGE_NAME..."
docker build -t $IMAGE_NAME -f Dockerfile.local-aws-sdk .

# Проверяем результат сборки
if [ $? -ne 0 ]; then
  echo "Ошибка при сборке Docker образа!"
  exit 1
fi

echo -e "\nDocker образ успешно собран!"

# Запускаем контейнер для проверки AWS SDK
echo -e "\nЗапуск временного контейнера для проверки AWS SDK..."
docker run --rm $IMAGE_NAME node -e "try { const { S3Client } = require('@aws-sdk/client-s3'); console.log('AWS SDK работает!'); } catch (e) { console.error('Ошибка:', e); process.exit(1); }"

# Проверяем результат выполнения
if [ $? -ne 0 ]; then
  echo "Ошибка при проверке AWS SDK в контейнере!"
  exit 1
fi

echo -e "\nПроверка завершена успешно! AWS SDK работает в Docker с локальными модулями."
echo "Теперь вы можете использовать Dockerfile.local-aws-sdk для сборки и запуска приложения."