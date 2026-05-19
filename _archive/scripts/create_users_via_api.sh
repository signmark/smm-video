#!/bin/bash

echo "Создание пользователей через API Directus"

# Получение токена администратора
echo "Получение токена администратора..."
ADMIN_TOKEN=$(curl -s -X POST https://directus.roboflow.tech/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"d1r3ctu5"}' | \
  jq -r '.data.access_token')

if [ "$ADMIN_TOKEN" = "null" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "Ошибка получения токена. Проверьте пароль администратора в docker-compose.yml"
  exit 1
fi

echo "Токен получен: ${ADMIN_TOKEN:0:20}..."

# Создание роли SMM Manager
echo "Создание роли SMM Manager..."
ROLE_RESPONSE=$(curl -s -X POST https://directus.roboflow.tech/roles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "SMM Manager User", "icon": "badge"}')

ROLE_ID=$(echo $ROLE_RESPONSE | jq -r '.data.id')
echo "Роль создана с ID: $ROLE_ID"

# Создание пользователя signmark@gmail.com
echo "Создание пользователя signmark@gmail.com..."
curl -s -X POST https://directus.roboflow.tech/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"signmark@gmail.com\",
    \"password\": \"password123\",
    \"first_name\": \"Sign\",
    \"last_name\": \"Mark\",
    \"role\": \"$ROLE_ID\",
    \"status\": \"active\"
  }"

# Создание SMM админа lbrspb@gmail.com
echo "Создание SMM админа lbrspb@gmail.com..."
curl -s -X POST https://directus.roboflow.tech/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "lbrspb@gmail.com",
    "password": "password123",
    "first_name": "SMM",
    "last_name": "Admin",
    "role": "b985af53-8e1e-4944-92e9-a96a8fd8f37f",
    "status": "active"
  }'

echo "Проверка созданных пользователей..."
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://directus.roboflow.tech/users?fields=email,first_name,last_name,role.name" | \
  jq '.data[] | {email, first_name, last_name, role: .role.name}'

echo "Пользователи созданы! Пароли: password123"