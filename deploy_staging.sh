#!/bin/bash

# Деплой staging среды на smm.roboflow.tech
# Использует те же Directus данные что и dev, но на отдельном сервере

echo "🚀 Деплой staging на smm.roboflow.tech"

# Проверяем переменные окружения
if [ -z "$STAGING_SERVER" ]; then
    STAGING_SERVER="root@roboflow.tech"
fi

if [ -z "$STAGING_PATH" ]; then
    STAGING_PATH="/var/www/smm-staging"
fi

echo "📡 Подключение к серверу: $STAGING_SERVER"
echo "📁 Путь на сервере: $STAGING_PATH"

# Деплой через SSH
ssh $STAGING_SERVER << 'ENDSSH'
    set -e
    
    # Переходим в директорию проекта
    cd /var/www/smm-staging || {
        echo "❌ Директория $STAGING_PATH не найдена"
        echo "🔧 Создаем новую директорию и клонируем репозиторий"
        mkdir -p /var/www/smm-staging
        cd /var/www/smm-staging
        git clone https://github.com/your-repo/smm-system.git .
    }
    
    echo "🔄 Обновление кода..."
    git fetch origin
    git reset --hard origin/main
    
    echo "🔧 Настройка staging окружения..."
    
    # Создаем .env файл для staging
    cat > .env << 'EOF'
NODE_ENV=staging
STAGING=true
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_ADMIN_EMAIL=admin@roboflow.tech
DIRECTUS_ADMIN_PASSWORD=QtpZ3dh7
VITE_DIRECTUS_URL=https://directus.roboflow.tech
PORT=5001
DOMAIN=smm.roboflow.tech
EOF
    
    echo "📦 Установка зависимостей..."
    npm install --production
    
    echo "🏗️ Сборка проекта..."
    npm run build
    
    echo "🔄 Перезапуск сервиса..."
    # Останавливаем существующий процесс
    pkill -f "node.*server" || true
    
    # Запускаем новый процесс в фоне
    nohup npm start > /var/log/smm-staging.log 2>&1 &
    
    echo "✅ Staging развернут успешно!"
    echo "🌐 Доступен по адресу: https://smm.roboflow.tech"
    
    # Проверяем статус
    sleep 3
    if curl -f -s http://localhost:5001/api/config > /dev/null; then
        echo "✅ Сервер отвечает корректно"
    else
        echo "❌ Сервер не отвечает, проверьте логи"
        tail -20 /var/log/smm-staging.log
    fi
ENDSSH

echo "🎉 Деплой staging завершен!"
echo "📋 Для проверки логов: ssh $STAGING_SERVER 'tail -f /var/log/smm-staging.log'"
echo "🔧 Для проверки конфигурации: curl https://smm.roboflow.tech/api/config"