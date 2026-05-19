#!/bin/bash

# Настройки
DOMAIN_NAME="roboflow.tech"
SYSTEM_DIR="/opt/smm-system"
SSL_EMAIL="admin@roboflow.tech"

# Функции логирования
log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

error() {
    echo "[ОШИБКА] $1" >&2
    exit 1
}

# Проверка прав root
if [ "$EUID" -ne 0 ]; then
    error "Скрипт должен запускаться от имени root"
fi

log "🚀 Развертывание SMM системы на $DOMAIN_NAME"

# Создание системной директории
log "Создаем директорию: $SYSTEM_DIR"
mkdir -p $SYSTEM_DIR
cd $SYSTEM_DIR

# Копирование файлов
log "Копируем файлы из: $(pwd)/../root/smm"
rsync -av --delete /root/smm/ $SYSTEM_DIR/smm/
rsync -av /root/docker-compose.yml $SYSTEM_DIR/ 2>/dev/null || log "docker-compose.yml не найден в /root"
rsync -av /root/Dockerfile-n8n $SYSTEM_DIR/ 2>/dev/null || log "Dockerfile-n8n не найден в /root"

# Создание директорий
log "Создаем директории..."
mkdir -p traefik_data postgres directus_data pgladmin_data n8n_data local-files

# Генерация паролей
POSTGRES_PASSWORD=$(openssl rand -base64 32)
DIRECTUS_ADMIN_PASSWORD=$(openssl rand -base64 16)
PASSWORD_PGADMIN=$(openssl rand -base64 16)
DIRECTUS_DB_PASSWORD="$POSTGRES_PASSWORD"

# Создание .env файла
log "Создаем конфигурацию..."
cat > .env << EOF
DOMAIN_NAME=$DOMAIN_NAME
SSL_EMAIL=$SSL_EMAIL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DIRECTUS_ADMIN_EMAIL=$SSL_EMAIL
DIRECTUS_ADMIN_PASSWORD=$DIRECTUS_ADMIN_PASSWORD
DIRECTUS_DB_PASSWORD=$DIRECTUS_DB_PASSWORD
PASSWORD_PGLADMIN=$PASSWORD_PGADMIN
SUBDOMAIN=n8n
PGLADMIN_SUBDOMAIN=pgladmin
GENERIC_TIMEZONE=Europe/Moscow
BEGET_S3_ACCESS_KEY=your_access_key
BEGET_S3_SECRET_KEY=your_secret_key
BEGET_S3_BUCKET=your_bucket
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
BEGET_S3_REGION=ru-1
EOF

# Статический сайт удален из конфигурации

# Создание Dockerfile для SMM если отсутствует
if [ ! -f "smm/Dockerfile" ]; then
    log "Создаем Dockerfile для SMM..."
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

# Обновление docker-compose.yml для roboflow.tech
if [ -f "docker-compose.yml" ]; then
    log "Обновляем docker-compose.yml для доменов $DOMAIN_NAME..."
    
    # Создаем резервную копию
    cp docker-compose.yml docker-compose.yml.backup
    
    # Заменяем домены на roboflow.tech
    sed -i "s/smm\.nplanner\.ru/smm.$DOMAIN_NAME/g" docker-compose.yml
    sed -i "s/smmniap\.pw/smmniap.$DOMAIN_NAME/g" docker-compose.yml
    
    # Заменяем переменные на конкретные значения
    sed -i "s/\${SUBDOMAIN}\.\${DOMAIN_NAME}/n8n.$DOMAIN_NAME/g" docker-compose.yml
    sed -i "s/\${PGLADMIN_SUBDOMAIN}\.\${DOMAIN_NAME}/pgladmin.$DOMAIN_NAME/g" docker-compose.yml
    
    log "Домены успешно обновлены в docker-compose.yml"
    
    # Показываем что изменилось
    log "Изменения в доменах:"
    grep -E "(Host\(|rule=Host)" docker-compose.yml || true
else
    error "Файл docker-compose.yml не найден"
fi

# Сохранение паролей
cat > passwords.txt << EOF
=== ПАРОЛИ ROBOFLOW.TECH ===
PostgreSQL: $POSTGRES_PASSWORD
Directus Admin: $DIRECTUS_ADMIN_PASSWORD
PgAdmin: $PASSWORD_PGLADMIN
Email: $SSL_EMAIL

=== ДОМЕНЫ ===
SMM: https://smm.$DOMAIN_NAME
Directus: https://directus.$DOMAIN_NAME
N8N: https://n8n.$DOMAIN_NAME
PgAdmin: https://pgladmin.$DOMAIN_NAME
EOF

log "Пароли сохранены в passwords.txt"

# Останавливаем старые контейнеры
log "Останавливаем старые контейнеры..."
docker-compose down 2>/dev/null || true

# Запуск системы
log "Запускаем систему..."
docker-compose up -d --build

if [ $? -eq 0 ]; then
    log "✅ Система успешно развернута!"
    log "📋 Проверьте passwords.txt для доступа к сервисам"
    log "🌐 Домены:"
    log "  - https://smm.$DOMAIN_NAME"
    log "  - https://directus.$DOMAIN_NAME"
    log "  - https://n8n.$DOMAIN_NAME"
    log "  - https://pgladmin.$DOMAIN_NAME"
else
    error "Ошибка при запуске системы"
fi