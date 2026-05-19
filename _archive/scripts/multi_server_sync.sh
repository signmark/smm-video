#!/bin/bash

# Автоматическая синхронизация SMM приложения между серверами
# Использует текущую рабочую версию из Replit для развертывания на других серверах

echo "=== Многосерверная синхронизация SMM системы ==="

# Создаем архив текущего проекта для развертывания
echo "Создание архива проекта..."
tar --exclude='node_modules' --exclude='.git' --exclude='uploads' --exclude='logs' \
    -czf smm-deployment.tar.gz \
    server/ client/ shared/ package.json .env.docker \
    docker-compose.yml Dockerfile

# Создаем универсальный deployment скрипт
cat > deploy_universal.sh << 'EOL'
#!/bin/bash

DEPLOYMENT_NAME="smm-$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/smm-backups"

echo "=== Развертывание SMM приложения ==="
echo "Deployment ID: $DEPLOYMENT_NAME"

# Создаем backup существующей версии
if [ -d "/root/smm-project" ]; then
    echo "Создание backup существующей версии..."
    mkdir -p $BACKUP_DIR
    mv /root/smm-project "$BACKUP_DIR/smm-backup-$(date +%Y%m%d-%H%M%S)"
fi

# Создаем новую директорию проекта
mkdir -p /root/smm-project
cd /root/smm-project

# Распаковываем новую версию
echo "Распаковка новой версии..."
tar -xzf /tmp/smm-deployment.tar.gz

# Копируем правильный .env файл
cp .env.docker .env

# Останавливаем существующие контейнеры
echo "Остановка существующих сервисов..."
docker-compose down 2>/dev/null || true
docker stop smm-1 2>/dev/null || true
docker rm smm-1 2>/dev/null || true

# Создаем необходимые директории
mkdir -p uploads/temp uploads/images logs

# Собираем и запускаем новые контейнеры
echo "Сборка и запуск новых контейнеров..."
docker-compose up -d --build

# Ждем запуска и проверяем статус
echo "Ожидание запуска сервисов..."
sleep 15

# Проверяем статус контейнеров
if docker ps | grep -q smm-1; then
    echo "✓ SMM контейнер запущен успешно"
    docker logs smm-1 --tail 10
    
    # Проверяем доступность HTTP
    echo "Проверка HTTP доступности..."
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000 | grep -q "200\|404"; then
        echo "✓ HTTP сервер отвечает"
    else
        echo "✗ HTTP сервер не отвечает"
        docker logs smm-1 --tail 20
    fi
else
    echo "✗ Ошибка запуска SMM контейнера"
    docker logs smm-1 --tail 20
    exit 1
fi

echo "=== Развертывание завершено успешно ==="
echo "Приложение доступно на порту 5000"
EOL

chmod +x deploy_universal.sh

echo "✓ Архив создан: smm-deployment.tar.gz"
echo "✓ Скрипт развертывания: deploy_universal.sh"
echo ""
echo "Для развертывания на сервере выполните:"
echo "1. Скопируйте файлы на сервер:"
echo "   scp smm-deployment.tar.gz deploy_universal.sh user@server:/tmp/"
echo ""
echo "2. На сервере выполните:"
echo "   cd /tmp && chmod +x deploy_universal.sh && ./deploy_universal.sh"
echo ""
echo "Система автоматически:"
echo "- Создаст backup текущей версии"
echo "- Развернет новую версию" 
echo "- Перезапустит сервисы"
echo "- Проверит статус развертывания"