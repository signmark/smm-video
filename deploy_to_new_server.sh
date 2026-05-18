#!/bin/bash

# Скрипт для развертывания SMM приложения на новом сервере 31.128.43.113
# Этот скрипт нужно запустить на самом сервере

echo "=== Развертывание SMM приложения на новом сервере ==="

# Переходим в домашнюю директорию
cd /root

# Клонируем последнюю версию проекта
echo "Клонирование проекта..."
if [ -d "smm-project" ]; then
    rm -rf smm-project
fi
git clone https://github.com/your-repo/smm-project.git || {
    echo "Создаем директорию проекта локально..."
    mkdir -p smm-project
    cd smm-project
}

# Создаем .env файл с правильными настройками для нового сервера
echo "Создание .env файла..."
cat > .env << 'EOL'
# Directus configuration - production credentials
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_ADMIN_EMAIL=lbrspb@gmail.com
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
DIRECTUS_DB_PASSWORD=QtpZ3dh7
VITE_DIRECTUS_URL=https://directus.roboflow.tech

# Server configuration
NODE_ENV=production
PORT=5000
DOCKER_ENV=true

# Session configuration
SESSION_SECRET=your-secure-session-secret-here

# Database configuration
DATABASE_URL=postgresql://postgres:QtpZ3dh7@localhost:5432/smm_db

# API Keys - will be loaded from Directus Global API Keys
EOL

# Создаем docker-compose.yml для SMM приложения
echo "Создание docker-compose.yml..."
cat > docker-compose.yml << 'EOL'
version: '3.8'

services:
  smm-app:
    build: .
    container_name: smm-1
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - DOCKER_ENV=true
      - DIRECTUS_URL=https://directus.roboflow.tech
      - DIRECTUS_ADMIN_EMAIL=lbrspb@gmail.com
      - DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - smm-network

networks:
  smm-network:
    external: true
EOL

# Создаем Dockerfile
echo "Создание Dockerfile..."
cat > Dockerfile << 'EOL'
FROM node:18-alpine

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Создаем необходимые директории
RUN mkdir -p uploads/temp uploads/images logs

# Открываем порт
EXPOSE 5000

# Запускаем приложение
CMD ["npm", "run", "start:prod"]
EOL

# Создаем package.json с минимальными зависимостями
echo "Создание package.json..."
cat > package.json << 'EOL'
{
  "name": "smm-manager",
  "version": "1.0.0",
  "description": "SMM Content Management System",
  "main": "server/index.js",
  "scripts": {
    "dev": "tsx server/index.ts",
    "start:prod": "node server/index.js",
    "build": "tsc"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "multer": "^1.4.5"
  }
}
EOL

# Останавливаем существующие контейнеры
echo "Остановка существующих контейнеров..."
docker-compose down 2>/dev/null || true
docker stop smm-1 2>/dev/null || true
docker rm smm-1 2>/dev/null || true

# Создаем сеть если не существует
docker network create smm-network 2>/dev/null || true

# Собираем и запускаем новый контейнер
echo "Сборка и запуск контейнера..."
docker-compose up -d --build

# Проверяем статус
echo "Проверка статуса контейнера..."
sleep 10
docker ps | grep smm-1

# Проверяем логи
echo "Проверка логов..."
docker logs smm-1 --tail 20

echo "=== Развертывание завершено ==="
echo "Приложение должно быть доступно на https://smm.roboflow.tech"
echo "Для проверки логов: docker logs smm-1 -f"
EOL