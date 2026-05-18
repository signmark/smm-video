#!/bin/bash

# Деплой ветки SLAVE на staging среду smm.roboflow.tech
# Этот скрипт основан на deploy_staging.sh, но использует ветку slave

echo "🚀 Деплой ветки SLAVE на staging smm.roboflow.tech"

if [ -z "$STAGING_SERVER" ]; then
    STAGING_SERVER="root@roboflow.tech"
fi

echo "📡 Подключение к серверу: $STAGING_SERVER"

# Деплой через SSH
ssh $STAGING_SERVER << 'ENDSSH'
    set -e
    
    cd /var/www/smm-staging || {
        echo "❌ Директория не найдена"
        exit 1
    }
    
    echo "🔄 Переключение на ветку slave и обновление кода..."
    git fetch origin
    git checkout slave
    git reset --hard origin/slave
    
    echo "🔧 Настройка staging окружения..."
    # (Оставляем .env как есть или обновляем если нужно)
    
    echo "📦 Установка зависимостей..."
    npm install --production
    
    echo "🏗️ Сборка проекта..."
    npm run build
    
    echo "🔄 Перезапуск сервиса..."
    pkill -f "node.*server" || true
    
    # Запускаем новый процесс в фоне
    nohup npm start > /var/log/smm-staging.log 2>&1 &
    
    echo "✅ Ветка SLAVE развернута на Staging успешно!"
ENDSSH

echo "🎉 Деплой завершен!"
