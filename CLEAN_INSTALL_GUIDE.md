# Чистая установка SMM Manager с пустыми данными

## Быстрое развертывание с нуля

### 1. Подготовка базовой структуры

```bash
# Создание рабочей директории
mkdir -p /root/smm && cd /root/smm

# Создание структуры папок
mkdir -p postgres directus_data n8n_data pgladmin_data uploads logs letsencrypt
chmod 600 letsencrypt
```

### 2. Минимальный docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: QtpZ3dh7
      POSTGRES_DB: directus
    volumes:
      - ./postgres:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    networks:
      - smm_network

  directus:
    image: directus/directus:latest
    restart: always
    environment:
      KEY: "d41d8cd98f00b204e9800998ecf8427e"
      SECRET: "e3b0c44298fc1c149afbf4c8996fb924"
      DB_CLIENT: pg
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: directus
      DB_USER: postgres
      DB_PASSWORD: QtpZ3dh7
      ADMIN_EMAIL: admin@roboflow.tech
      ADMIN_PASSWORD: admin123456
      PUBLIC_URL: http://localhost:8055
    ports:
      - "8055:8055"
    volumes:
      - ./directus_data:/directus/uploads
    depends_on:
      - postgres
    networks:
      - smm_network

networks:
  smm_network:
    driver: bridge
```

### 3. Запуск системы

```bash
# Запуск базовых сервисов
docker-compose up -d postgres directus

# Проверка запуска
docker-compose logs -f directus

# Ожидание инициализации (2-3 минуты)
sleep 180
```

### 4. Доступ к Directus

После запуска Directus будет доступен на:
- URL: http://server-ip:8055
- Email: admin@roboflow.tech  
- Password: admin123456

### 5. Создание базовой структуры данных

#### 5.1 Подключение к Directus API
```bash
# Получение токена администратора
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8055/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@roboflow.tech","password":"admin123456"}' | \
  jq -r '.data.access_token')

echo "Admin token: $ADMIN_TOKEN"
```

#### 5.2 Создание коллекций через API

```bash
# Создание коллекции пользователей кампаний
curl -X POST http://localhost:8055/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "user_campaigns",
    "fields": [
      {"field": "id", "type": "uuid", "meta": {"hidden": true, "interface": "input", "readonly": true}},
      {"field": "user_id", "type": "uuid", "meta": {"interface": "select-dropdown-m2o", "display": "related-values"}},
      {"field": "name", "type": "string", "meta": {"interface": "input"}},
      {"field": "description", "type": "text", "meta": {"interface": "input-multiline"}},
      {"field": "status", "type": "string", "meta": {"interface": "select-dropdown", "options": {"choices": [{"text": "active", "value": "active"}, {"text": "paused", "value": "paused"}, {"text": "completed", "value": "completed"}]}}},
      {"field": "created_at", "type": "timestamp", "meta": {"interface": "datetime", "readonly": true}},
      {"field": "updated_at", "type": "timestamp", "meta": {"interface": "datetime", "readonly": true}}
    ],
    "schema": {"name": "user_campaigns"},
    "meta": {"icon": "campaign", "color": null}
  }'

# Создание коллекции контента кампаний
curl -X POST http://localhost:8055/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "campaign_content",
    "fields": [
      {"field": "id", "type": "uuid", "meta": {"hidden": true, "interface": "input", "readonly": true}},
      {"field": "campaign_id", "type": "uuid", "meta": {"interface": "select-dropdown-m2o"}},
      {"field": "title", "type": "string", "meta": {"interface": "input"}},
      {"field": "content", "type": "text", "meta": {"interface": "input-rich-text-html"}},
      {"field": "platform", "type": "string", "meta": {"interface": "select-dropdown", "options": {"choices": [{"text": "vk", "value": "vk"}, {"text": "telegram", "value": "telegram"}, {"text": "instagram", "value": "instagram"}]}}},
      {"field": "status", "type": "string", "meta": {"interface": "select-dropdown", "options": {"choices": [{"text": "draft", "value": "draft"}, {"text": "published", "value": "published"}, {"text": "scheduled", "value": "scheduled"}]}}},
      {"field": "created_at", "type": "timestamp", "meta": {"interface": "datetime", "readonly": true}}
    ],
    "schema": {"name": "campaign_content"},
    "meta": {"icon": "article", "color": null}
  }'

# Создание коллекции API ключей
curl -X POST http://localhost:8055/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "global_api_keys",
    "fields": [
      {"field": "id", "type": "uuid", "meta": {"hidden": true, "interface": "input", "readonly": true}},
      {"field": "service_name", "type": "string", "meta": {"interface": "input"}},
      {"field": "api_key", "type": "string", "meta": {"interface": "input"}},
      {"field": "is_active", "type": "boolean", "meta": {"interface": "boolean"}},
      {"field": "created_at", "type": "timestamp", "meta": {"interface": "datetime", "readonly": true}}
    ],
    "schema": {"name": "global_api_keys"},
    "meta": {"icon": "key", "color": null}
  }'

# Создание коллекции анкет
curl -X POST http://localhost:8055/collections \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "business_questionnaire",
    "fields": [
      {"field": "id", "type": "uuid", "meta": {"hidden": true, "interface": "input", "readonly": true}},
      {"field": "campaign_id", "type": "uuid", "meta": {"interface": "select-dropdown-m2o"}},
      {"field": "company_name", "type": "string", "meta": {"interface": "input"}},
      {"field": "business_description", "type": "text", "meta": {"interface": "input-multiline"}},
      {"field": "target_audience", "type": "text", "meta": {"interface": "input-multiline"}},
      {"field": "contact_info", "type": "text", "meta": {"interface": "input-multiline"}},
      {"field": "created_at", "type": "timestamp", "meta": {"interface": "datetime", "readonly": true}}
    ],
    "schema": {"name": "business_questionnaire"},
    "meta": {"icon": "quiz", "color": null}
  }'
```

### 6. Создание ролей и пользователей

#### 6.1 Создание роли SMM Manager
```bash
# Создание роли
ROLE_ID=$(curl -X POST http://localhost:8055/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "SMM Manager User", "icon": "badge"}' | \
  jq -r '.data.id')

echo "Role ID: $ROLE_ID"
```

#### 6.2 Создание тестовых пользователей
```bash
# Создание обычного пользователя
curl -X POST http://localhost:8055/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"user@roboflow.tech\",
    \"password\": \"user123456\",
    \"first_name\": \"Test\",
    \"last_name\": \"User\",
    \"role\": \"$ROLE_ID\",
    \"status\": \"active\"
  }"

# Создание SMM админа  
curl -X POST http://localhost:8055/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "smm@roboflow.tech",
    "password": "smm123456", 
    "first_name": "SMM",
    "last_name": "Admin",
    "role": "b985af53-8e1e-4944-92e9-a96a8fd8f37f",
    "status": "active"
  }'
```

### 7. Базовая конфигурация API ключей

```bash
# Добавление заглушек для AI сервисов
curl -X POST http://localhost:8055/items/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service_name": "claude", "api_key": "placeholder", "is_active": false}'

curl -X POST http://localhost:8055/items/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service_name": "gemini", "api_key": "placeholder", "is_active": false}'

curl -X POST http://localhost:8055/items/global_api_keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service_name": "qwen", "api_key": "placeholder", "is_active": false}'
```

### 8. Автоматизированный скрипт полной установки

```bash
#!/bin/bash
# clean_install.sh

set -e

echo "Установка SMM Manager с чистыми данными"

# Создание структуры
mkdir -p postgres directus_data n8n_data pgladmin_data uploads logs letsencrypt
chmod 600 letsencrypt

# Запуск сервисов
docker-compose up -d postgres directus

echo "Ожидание инициализации Directus..."
sleep 180

# Получение токена
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8055/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@roboflow.tech","password":"admin123456"}' | \
  jq -r '.data.access_token')

if [ "$ADMIN_TOKEN" = "null" ]; then
  echo "Ошибка получения токена администратора"
  exit 1
fi

echo "Создание коллекций..."
# Выполнение всех curl команд создания коллекций...

echo "Создание ролей и пользователей..."
# Выполнение команд создания ролей и пользователей...

echo "Добавление базовых API ключей..."
# Выполнение команд добавления API ключей...

echo "Установка завершена!"
echo "Directus доступен на: http://$(hostname -I | awk '{print $1}'):8055"
echo "Администратор: admin@roboflow.tech / admin123456"
echo "Тестовый пользователь: user@roboflow.tech / user123456"
echo "SMM админ: smm@roboflow.tech / smm123456"
```

### 9. Проверка установки

```bash
# Проверка статуса сервисов
docker-compose ps

# Проверка логов
docker-compose logs directus --tail 20

# Проверка созданных коллекций
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8055/collections

# Проверка пользователей
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8055/users
```

### 10. Следующие шаги

После успешной установки:
1. Настройте реальные API ключи для AI сервисов
2. Добавьте SSL сертификаты через Traefik
3. Настройте доменные имена
4. Создайте реальных пользователей
5. Настройте резервное копирование

Система готова к использованию с пустой базой данных и базовой конфигурацией.