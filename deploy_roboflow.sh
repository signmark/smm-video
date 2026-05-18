#!/bin/bash

# Скрипт автоматического развертывания SMM системы на roboflow.tech
set -e

echo "🚀 Начинаем развертывание SMM системы на roboflow.tech"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Функция для логирования
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Проверка, что скрипт запущен от root
if [[ $EUID -ne 0 ]]; then
   error "Этот скрипт должен быть запущен от root пользователя"
fi

# Проверка наличия docker и docker-compose
log "Проверяем наличие Docker..."
if ! command -v docker &> /dev/null; then
    error "Docker не установлен. Установите Docker и повторите попытку."
fi

if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose не установлен. Установите Docker Compose и повторите попытку."
fi

# Создание директории проекта
PROJECT_DIR="/opt/smm-system"
log "Создаем директорию проекта: $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"

# Определение текущей директории как источника
CURRENT_DIR=$(pwd)
log "Копируем файлы из текущей директории: $CURRENT_DIR"

# Копирование всех файлов проекта
log "Копируем файлы проекта..."
rsync -av --exclude='.git' --exclude='node_modules' --exclude='postgres' --exclude='directus_data' --exclude='n8n_data' --exclude='pgadmin_data' --exclude='traefik_data' "$CURRENT_DIR/" "$PROJECT_DIR/"

cd "$PROJECT_DIR"

# Создание файла переменных окружения
log "Создаем файл переменных окружения..."
cat > .env << EOF
# Домен и SSL
DOMAIN_NAME=roboflow.tech
SUBDOMAIN=n8n
PGADMIN_SUBDOMAIN=pgadmin
SSL_EMAIL=admin@roboflow.tech

# Пароли (будут заменены на безопасные)
POSTGRES_PASSWORD=$(openssl rand -base64 32)
PASSWORD_PGADMIN=$(openssl rand -base64 32)
DIRECTUS_DB_PASSWORD=$(openssl rand -base64 32)
DIRECTUS_ADMIN_EMAIL=admin@roboflow.tech
DIRECTUS_ADMIN_PASSWORD=$(openssl rand -base64 32)

# Timezone
GENERIC_TIMEZONE=Europe/Moscow

# Beget S3 Storage (нужно будет настроить)
BEGET_S3_ACCESS_KEY=YOUR_BEGET_ACCESS_KEY
BEGET_S3_SECRET_KEY=YOUR_BEGET_SECRET_KEY
BEGET_S3_BUCKET=YOUR_BUCKET_NAME
BEGET_S3_ENDPOINT=https://s3.ru1.storage.beget.cloud
BEGET_S3_REGION=ru-1

# API ключи (нужно будет настроить)
GEMINI_API_KEY=YOUR_GEMINI_KEY
GOOGLE_API_KEY=YOUR_GOOGLE_KEY
GOOGLE_SERVICE_ACCOUNT_KEY=YOUR_SERVICE_ACCOUNT_JSON
QWEN_API_KEY=YOUR_QWEN_KEY
EOF

# Создание необходимых директорий
log "Создаем необходимые директории..."
mkdir -p traefik_data postgres directus_data n8n_data pgadmin_data smm/uploads smm/logs

# Установка правильных прав доступа
log "Устанавливаем права доступа..."
chmod 600 .env
chmod 755 traefik_data postgres directus_data n8n_data pgadmin_data
chown -R 1000:1000 n8n_data
chown -R 5050:5050 pgadmin_data

# Копирование конфигурации Docker Compose
log "Копируем конфигурацию Docker Compose..."
cp docker-compose.roboflow.yml docker-compose.yml

# Создание конфигурации nginx для статического сайта
log "Создаем конфигурацию nginx..."
mkdir -p smm/smmniap_static
cat > smm/smmniap_static/index.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>SMM NIAP - roboflow.tech</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>SMM NIAP System</h1>
    <p>Система развернута на roboflow.tech</p>
    <ul>
        <li><a href="https://smm.roboflow.tech">SMM Система</a></li>
        <li><a href="https://directus.roboflow.tech">Directus CMS</a></li>
        <li><a href="https://n8n.roboflow.tech">N8N Автоматизация</a></li>
        <li><a href="https://pgadmin.roboflow.tech">PgAdmin</a></li>
    </ul>
</body>
</html>
EOF

# Вывод информации о паролях
log "Сохраняем сгенерированные пароли в файл passwords.txt..."
cat > passwords.txt << EOF
=== СГЕНЕРИРОВАННЫЕ ПАРОЛИ ===
Сохраните этот файл в безопасном месте!

PostgreSQL Password: $(grep POSTGRES_PASSWORD .env | cut -d'=' -f2)
PgAdmin Password: $(grep PASSWORD_PGADMIN .env | cut -d'=' -f2)
Directus DB Password: $(grep DIRECTUS_DB_PASSWORD .env | cut -d'=' -f2)
Directus Admin Password: $(grep DIRECTUS_ADMIN_PASSWORD .env | cut -d'=' -f2)

=== ДОСТУП К СИСТЕМАМ ===
SMM Система: https://smm.roboflow.tech
Directus CMS: https://directus.roboflow.tech
N8N Автоматизация: https://n8n.roboflow.tech
PgAdmin: https://pgadmin.roboflow.tech
Статический сайт: https://smmniap.roboflow.tech

Admin Email для Directus: admin@roboflow.tech
EOF

chmod 600 passwords.txt

# Проверка DNS записей
log "Проверяем DNS записи..."
DOMAINS=("smm.roboflow.tech" "directus.roboflow.tech" "n8n.roboflow.tech" "pgadmin.roboflow.tech" "smmniap.roboflow.tech")
for domain in "${DOMAINS[@]}"; do
    if nslookup "$domain" > /dev/null 2>&1; then
        log "✓ DNS запись для $domain настроена"
    else
        warn "⚠ DNS запись для $domain не найдена"
    fi
done

# Запуск системы
log "Запускаем систему..."
docker-compose up -d

# Ожидание запуска сервисов
log "Ждем запуска сервисов..."
sleep 30

# Проверка статуса контейнеров
log "Проверяем статус контейнеров..."
docker-compose ps

# Вывод финальной информации
echo ""
echo -e "${GREEN}🎉 Развертывание завершено!${NC}"
echo ""
echo "📋 Информация о системе:"
echo "  • Директория проекта: $PROJECT_DIR"
echo "  • Файл паролей: $PROJECT_DIR/passwords.txt"
echo "  • Конфигурация: $PROJECT_DIR/.env"
echo ""
echo "🔧 Что нужно сделать дальше:"
echo "  1. Настроить API ключи в файле .env:"
echo "     - GEMINI_API_KEY"
echo "     - GOOGLE_API_KEY"
echo "     - GOOGLE_SERVICE_ACCOUNT_KEY"
echo "     - QWEN_API_KEY"
echo "     - BEGET_S3_ACCESS_KEY и BEGET_S3_SECRET_KEY"
echo ""
echo "  2. Перезапустить систему:"
echo "     cd $PROJECT_DIR && docker-compose restart"
echo ""
echo "  3. Проверить доступность:"
echo "     curl -I https://smm.roboflow.tech"
echo ""
echo "🔑 Логины и пароли сохранены в файле: passwords.txt"

# Создание скрипта для быстрого управления
cat > manage.sh << 'EOF'
#!/bin/bash
cd /opt/smm-system

case "$1" in
    start)
        docker-compose up -d
        ;;
    stop)
        docker-compose down
        ;;
    restart)
        docker-compose restart
        ;;
    logs)
        docker-compose logs -f ${2:-smm}
        ;;
    status)
        docker-compose ps
        ;;
    update)
        git pull
        docker-compose build
        docker-compose up -d
        ;;
    *)
        echo "Использование: $0 {start|stop|restart|logs|status|update}"
        echo "  logs [service] - показать логи (по умолчанию smm)"
        exit 1
        ;;
esac
EOF

chmod +x manage.sh
ln -sf "$PROJECT_DIR/manage.sh" /usr/local/bin/smm-manage

log "Создан скрипт управления: smm-manage"
log "Использование: smm-manage {start|stop|restart|logs|status|update}"

echo ""
echo -e "${GREEN}✅ Скрипт развертывания завершен успешно!${NC}"