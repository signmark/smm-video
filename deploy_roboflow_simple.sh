#!/bin/bash

# Простой скрипт развертывания SMM системы на roboflow.tech
set -e

echo "🚀 Развертывание SMM системы на roboflow.tech"

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Проверка Docker
if ! command -v docker &> /dev/null; then
    error "Docker не установлен"
fi

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose не установлен"
fi

# Создание директории проекта
PROJECT_DIR="/opt/smm-system"
log "Создаем директорию: $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"

# Копирование файлов из текущей директории
CURRENT_DIR=$(pwd)
log "Копируем файлы из: $CURRENT_DIR"

# Копируем все файлы, исключая системные директории
rsync -av \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='postgres' \
  --exclude='directus_data' \
  --exclude='n8n_data' \
  --exclude='pgadmin_data' \
  --exclude='traefik_data' \
  "$CURRENT_DIR/" "$PROJECT_DIR/"

cd "$PROJECT_DIR"

# Создание .env файла
log "Создаем конфигурацию..."
cat > .env << EOF
# Домен
DOMAIN_NAME=roboflow.tech
SUBDOMAIN=n8n
PGLADMIN_SUBDOMAIN=pgadmin
SSL_EMAIL=admin@roboflow.tech

# Пароли
POSTGRES_PASSWORD=$(openssl rand -base64 32)
PASSWORD_PGADMIN=$(openssl rand -base64 32)
DIRECTUS_DB_PASSWORD=$(openssl rand -base64 32)
DIRECTUS_ADMIN_EMAIL=admin@roboflow.tech
DIRECTUS_ADMIN_PASSWORD=$(openssl rand -base64 32)

# Timezone
GENERIC_TIMEZONE=Europe/Moscow

# API ключи (настроить вручную)
GEMINI_API_KEY=your_key
GOOGLE_API_KEY=your_key
GOOGLE_SERVICE_ACCOUNT_KEY=your_json
QWEN_API_KEY=your_key
BEGET_S3_ACCESS_KEY=your_key
BEGET_S3_SECRET_KEY=your_key
BEGET_S3_BUCKET=your_bucket
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
BEGET_S3_REGION=ru-1
EOF

# Создание директорий
log "Создаем директории..."
mkdir -p traefik_data postgres directus_data n8n_data pgadmin_data smm/uploads smm/logs

# Права доступа
chmod 600 .env
chmod 755 traefik_data postgres directus_data n8n_data pgadmin_data
chown -R 1000:1000 n8n_data
chown -R 5050:5050 pgadmin_data

# Создание индексной страницы
mkdir -p smm/smmniap_static
cat > smm/smmniap_static/index.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>SMM System - roboflow.tech</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>SMM System on roboflow.tech</h1>
    <ul>
        <li><a href="https://smm.roboflow.tech">SMM Application</a></li>
        <li><a href="https://directus.roboflow.tech">Directus CMS</a></li>
        <li><a href="https://n8n.roboflow.tech">N8N Automation</a></li>
        <li><a href="https://pgadmin.roboflow.tech">PgAdmin</a></li>
    </ul>
</body>
</html>
EOF

# Создание недостающего Dockerfile в папке smm
if [ ! -f "smm/Dockerfile" ]; then
    log "Создаем недостающий Dockerfile в папке smm..."
    cat > smm/Dockerfile << 'DOCKERFILE_EOF'
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Создаем директории для uploads и logs
RUN mkdir -p uploads logs

# Устанавливаем права
RUN chown -R node:node /app

USER node

EXPOSE 5000

CMD ["npm", "run", "dev"]
DOCKERFILE_EOF
fi

# Проверка существования Dockerfile-n8n
if [ ! -f "Dockerfile-n8n" ]; then
    log "ВНИМАНИЕ: Dockerfile-n8n не найден, используем базовый образ n8n"
else
    log "Найден существующий Dockerfile-n8n, используем его"
fi

# Обновление существующего docker-compose.yml для roboflow.tech
if [ -f "docker-compose.yml" ]; then
    log "Обновляем существующий docker-compose.yml для доменов roboflow.tech..."
    # Создаем резервную копию
    cp docker-compose.yml docker-compose.yml.backup
    
    # Обновляем домены в docker-compose.yml
    sed -i "s/smm\.nplanner\.ru/smm.${DOMAIN_NAME}/g" docker-compose.yml
    sed -i "s/smmniap\.pw/smmniap.${DOMAIN_NAME}/g" docker-compose.yml
    sed -i "s/\${SUBDOMAIN}\.\${DOMAIN_NAME}/n8n.${DOMAIN_NAME}/g" docker-compose.yml
    sed -i "s/\${PGADMIN_SUBDOMAIN}\.\${DOMAIN_NAME}/pgadmin.${DOMAIN_NAME}/g" docker-compose.yml
    
    log "Docker-compose.yml обновлен для доменов roboflow.tech"
else
    error "Файл docker-compose.yml не найден в текущей директории"
fi

# Сохранение паролей
cat > passwords.txt << EOF
=== ПАРОЛИ ===
PostgreSQL: $(grep POSTGRES_PASSWORD .env | cut -d'=' -f2)
PgAdmin: $(grep PASSWORD_PGADMIN .env | cut -d'=' -f2)
Directus Admin: $(grep DIRECTUS_ADMIN_PASSWORD .env | cut -d'=' -f2)

=== ДОСТУП ===
SMM: https://smm.roboflow.tech
Directus: https://directus.roboflow.tech
N8N: https://n8n.roboflow.tech
PgAdmin: https://pgadmin.roboflow.tech
EOF

chmod 600 passwords.txt

# Запуск
log "Запускаем систему..."
docker-compose up -d

sleep 10

# Статус
log "Проверяем статус..."
docker-compose ps

# Создание команды управления
cat > /usr/local/bin/smm-manage << 'EOF'
#!/bin/bash
cd /opt/smm-system
case "$1" in
    start) docker-compose up -d ;;
    stop) docker-compose down ;;
    restart) docker-compose restart ;;
    logs) docker-compose logs -f ${2:-smm} ;;
    status) docker-compose ps ;;
    update) 
        git pull origin roboflow
        docker-compose build
        docker-compose up -d
        ;;
    *) echo "Использование: $0 {start|stop|restart|logs|status|update}" ;;
esac
EOF

chmod +x /usr/local/bin/smm-manage

echo ""
echo -e "${GREEN}✅ Развертывание завершено!${NC}"
echo ""
echo "📁 Проект: $PROJECT_DIR"
echo "🔑 Пароли: $PROJECT_DIR/passwords.txt" 
echo "⚙️ Управление: smm-manage {start|stop|restart|logs|status|update}"
echo ""
echo "🔧 Настройте API ключи в .env и выполните:"
echo "   smm-manage restart"