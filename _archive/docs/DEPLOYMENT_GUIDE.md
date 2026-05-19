# Руководство по развертыванию SMM Manager с нуля

## Требования к серверу

- Ubuntu 20.04+ или Debian 11+
- Docker и Docker Compose
- Минимум 4GB RAM, 20GB свободного места
- Открытые порты: 80, 443, 5000, 8055, 5432

## Структура системы

Система состоит из следующих компонентов:
- **Traefik** - реверс-прокси с автоматическими SSL сертификатами
- **PostgreSQL** - основная база данных
- **Directus** - headless CMS для управления данными
- **N8N** - автоматизация workflow
- **PgAdmin** - веб-интерфейс для управления базой данных
- **SMM Manager** - основное приложение

## Пошаговое развертывание

### 1. Подготовка сервера

```bash
# Обновление системы
apt update && apt upgrade -y

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Установка Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Создание рабочей директории
mkdir -p /root/smm && cd /root/smm
```

### 2. Настройка DNS записей

Создайте следующие A-записи, указывающие на IP сервера:
- `smm.yourdomain.com` - основное приложение
- `directus.yourdomain.com` - панель управления данными
- `n8n.yourdomain.com` - автоматизация
- `pgladmin.yourdomain.com` - управление базой данных

### 3. Создание конфигурационных файлов

#### docker-compose.yml
```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v3.3
    restart: always
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.myresolver.acme.httpchallenge=true"
      - "--certificatesresolvers.myresolver.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.myresolver.acme.email=admin@yourdomain.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "./letsencrypt:/letsencrypt"
    networks:
      - smm_network

  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: your_secure_password
      POSTGRES_DB: directus
    volumes:
      - ./postgres:/var/lib/postgresql/data
    networks:
      - smm_network

  directus:
    image: directus/directus:latest
    restart: always
    environment:
      KEY: your_directus_key_32_chars_long
      SECRET: your_directus_secret_32_chars
      DB_CLIENT: pg
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: directus
      DB_USER: postgres
      DB_PASSWORD: your_secure_password
      ADMIN_EMAIL: admin@yourdomain.com
      ADMIN_PASSWORD: your_admin_password
      PUBLIC_URL: https://directus.yourdomain.com
    volumes:
      - ./directus_data:/directus/uploads
    depends_on:
      - postgres
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.directus.rule=Host(`directus.yourdomain.com`)"
      - "traefik.http.routers.directus.entrypoints=websecure"
      - "traefik.http.routers.directus.tls.certresolver=myresolver"
      - "traefik.http.services.directus.loadbalancer.server.port=8055"
    networks:
      - smm_network

  n8n:
    image: n8nio/n8n:latest
    restart: always
    environment:
      N8N_HOST: n8n.yourdomain.com
      N8N_PROTOCOL: https
      N8N_PORT: 5678
      WEBHOOK_URL: https://n8n.yourdomain.com/
      GENERIC_TIMEZONE: Europe/Moscow
    volumes:
      - ./n8n_data:/home/node/.n8n
    depends_on:
      - postgres
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.n8n.rule=Host(`n8n.yourdomain.com`)"
      - "traefik.http.routers.n8n.entrypoints=websecure"
      - "traefik.http.routers.n8n.tls.certresolver=myresolver"
      - "traefik.http.services.n8n.loadbalancer.server.port=5678"
    networks:
      - smm_network

  pgadmin:
    image: dpage/pgadmin4:latest
    restart: always
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@yourdomain.com
      PGADMIN_DEFAULT_PASSWORD: your_pgadmin_password
    volumes:
      - ./pgadmin_data:/var/lib/pgladmin
    depends_on:
      - postgres
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.pgadmin.rule=Host(`pgladmin.yourdomain.com`)"
      - "traefik.http.routers.pgadmin.entrypoints=websecure"
      - "traefik.http.routers.pgadmin.tls.certresolver=myresolver"
      - "traefik.http.services.pgladmin.loadbalancer.server.port=80"
    networks:
      - smm_network

  smm:
    build: .
    restart: always
    environment:
      NODE_ENV: production
      PORT: 5000
      DATABASE_URL: postgresql://postgres:your_secure_password@postgres:5432/directus
      DIRECTUS_URL: https://directus.yourdomain.com
      DIRECTUS_ADMIN_EMAIL: admin@yourdomain.com
      DIRECTUS_ADMIN_PASSWORD: your_admin_password
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      - postgres
      - directus
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.smm.rule=Host(`smm.yourdomain.com`)"
      - "traefik.http.routers.smm.entrypoints=websecure"
      - "traefik.http.routers.smm.tls.certresolver=myresolver"
      - "traefik.http.services.smm.loadbalancer.server.port=5000"
    networks:
      - smm_network

networks:
  smm_network:
    driver: bridge
```

#### Dockerfile для SMM приложения
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Установка tsx глобально
RUN npm install -g tsx ts-node

# Копирование файлов package
COPY package*.json ./
RUN npm install

# Копирование исходного кода
COPY . .

# Сборка клиентской части
RUN npm run build

# Создание необходимых директорий
RUN mkdir -p uploads logs

EXPOSE 5000

CMD ["npm", "run", "start"]
```

#### .env файл
```env
# Database
DATABASE_URL=postgresql://postgres:your_secure_password@postgres:5432/directus

# Directus
DIRECTUS_URL=https://directus.yourdomain.com
DIRECTUS_ADMIN_EMAIL=admin@yourdomain.com
DIRECTUS_ADMIN_PASSWORD=your_admin_password
DIRECTUS_KEY=your_directus_key_32_chars_long
DIRECTUS_SECRET=your_directus_secret_32_chars

# Application
NODE_ENV=production
PORT=5000
PUBLIC_URL=https://smm.yourdomain.com

# AI APIs (настраиваются позже)
GOOGLE_API_KEY=
GOOGLE_SERVICE_ACCOUNT_KEY=
QWEN_API_KEY=
CLAUDE_API_KEY=
```

### 4. Запуск системы

```bash
# Создание необходимых директорий
mkdir -p postgres directus_data n8n_data pgadmin_data uploads logs letsencrypt

# Установка прав доступа
chmod 600 letsencrypt
chown -R 1000:1000 n8n_data

# Запуск системы
docker-compose up -d

# Проверка статуса
docker-compose logs -f
```

### 5. Первоначальная настройка

#### 5.1 Настройка Directus
1. Перейдите на `https://directus.yourdomain.com`
2. Войдите с учетными данными администратора
3. Создайте коллекции для пользователей, кампаний, контента
4. Настройте роли и права доступа

#### 5.2 Настройка N8N
1. Перейдите на `https://n8n.yourdomain.com`
2. Создайте учетную запись администратора
3. Импортируйте рабочие процессы для автоматизации

#### 5.3 Настройка PgAdmin
1. Перейдите на `https://pgladmin.yourdomain.com`
2. Войдите с учетными данными PgAdmin
3. Добавьте подключение к серверу PostgreSQL:
   - Host: postgres
   - Port: 5432
   - Database: directus
   - Username: postgres
   - Password: your_secure_password

### 6. Настройка API ключей

#### 6.1 Google AI API
1. Перейдите в Google Cloud Console
2. Создайте проект и включите Vertex AI API
3. Создайте сервисный аккаунт и скачайте JSON ключ
4. Добавьте ключи в переменные окружения

#### 6.2 Другие AI сервисы
- Claude API: получите ключ от Anthropic
- Qwen API: получите ключ от Alibaba Cloud

### 7. Резервное копирование

#### Скрипт автоматического бэкапа
```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Бэкап базы данных
docker exec $(docker ps | grep postgres | awk '{print $1}') pg_dump -U postgres directus > $BACKUP_DIR/directus_$DATE.sql

# Бэкап файлов
tar -czf $BACKUP_DIR/files_$DATE.tar.gz directus_data uploads n8n_data

# Удаление старых бэкапов (старше 7 дней)
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

#### Автоматизация бэкапов
```bash
# Добавить в crontab
crontab -e

# Ежедневный бэкап в 2:00
0 2 * * * /root/smm/backup.sh >> /var/log/backup.log 2>&1
```

### 8. Мониторинг и логи

#### Просмотр логов
```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f smm
docker-compose logs -f directus
```

#### Мониторинг ресурсов
```bash
# Использование ресурсов контейнерами
docker stats

# Место на диске
df -h
du -sh postgres directus_data n8n_data
```

### 9. Обслуживание

#### Обновление системы
```bash
# Остановка сервисов
docker-compose down

# Обновление образов
docker-compose pull

# Запуск с новыми образами
docker-compose up -d

# Очистка старых образов
docker image prune -f
```

#### Перезапуск сервисов
```bash
# Перезапуск всех сервисов
docker-compose restart

# Перезапуск конкретного сервиса
docker-compose restart smm
```

### 10. Устранение неполадок

#### Частые проблемы

**Directus не запускается:**
- Проверьте подключение к базе данных
- Убедитесь что все переменные окружения заданы
- Проверьте логи: `docker-compose logs directus`

**SSL сертификаты не работают:**
- Убедитесь что DNS записи правильно настроены
- Проверьте что порты 80 и 443 открыты
- Проверьте логи Traefik: `docker-compose logs traefik`

**Нет доступа к базе данных:**
- Проверьте что PostgreSQL запущен: `docker-compose ps postgres`
- Проверьте подключение через PgAdmin
- Убедитесь в правильности паролей

#### Полезные команды
```bash
# Подключение к контейнеру
docker exec -it smm_postgres_1 bash
docker exec -it smm_smm_1 bash

# Просмотр логов в реальном времени
tail -f logs/app.log

# Проверка сетевых подключений
docker network ls
docker network inspect smm_smm_network
```

### 11. Безопасность

#### Рекомендации
- Используйте сложные пароли для всех сервисов
- Регулярно обновляйте Docker образы
- Настройте файрвол для ограничения доступа
- Включите автоматические обновления безопасности
- Регулярно проверяйте логи на подозрительную активность

#### Настройка файрвола
```bash
# Установка ufw
apt install ufw

# Базовые правила
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80
ufw allow 443

# Включение файрвола
ufw enable
```

Это руководство обеспечивает полное развертывание SMM Manager системы с нуля на новом сервере.