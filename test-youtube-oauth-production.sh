#!/bin/bash

echo "🔍 Проверка YouTube OAuth на продакшене"
echo "=================================="

# Настройки продакшена
PROD_URL="https://smm.omemo.tech"
PROD_API_URL="$PROD_URL/api"

echo "📡 Продакшен URL: $PROD_URL"
echo ""

# 1. Проверим доступность API
echo "1️⃣ Проверяем доступность API..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" "$PROD_API_URL/auth/me" || echo "❌ API недоступен"
echo ""

# 2. Проверим авторизацию
echo "2️⃣ Проверяем авторизацию (должен быть 401)..."
curl -s "$PROD_API_URL/auth/me" | head -100
echo ""

# 3. Тестируем YouTube OAuth без авторизации 
echo "3️⃣ Тестируем YouTube OAuth start (должен быть 401)..."
curl -s -X POST "$PROD_API_URL/youtube/auth/start" \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "test"}' | head -100
echo ""

# 4. Проверим здоровье сервера
echo "4️⃣ Проверяем здоровье сервера..."
curl -s "$PROD_URL/health" | head -100 || echo "❌ Health endpoint недоступен"
echo ""

# 5. Проверим логи через API (если доступно)
echo "5️⃣ Проверяем доступность логов..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" "$PROD_API_URL/logs" || echo "❌ Logs endpoint недоступен"
echo ""

echo "✅ Проверка завершена"
echo "💡 Для полной проверки нужны действующие токены авторизации"