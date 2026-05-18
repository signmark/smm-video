#!/bin/bash

echo "🔍 Проверка YouTube конфигурации на продакшене"
echo "============================================="

PROD_URL="https://smm.omemo.tech"

# Тестируем реальный YouTube OAuth flow на продакшене
echo "1️⃣ Попробуем запустить YouTube OAuth (с реальными данными)..."
echo "URL: $PROD_URL/api/youtube/auth/start"

# Это должно вернуть ошибку авторизации, но в логах покажет конфигурацию
curl -s -X POST "$PROD_URL/api/youtube/auth/start" \
  -H "Content-Type: application/json" \
  -d '{"campaignId": "test-production-check"}' \
  -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "2️⃣ Проверяем redirect URI endpoint..."
curl -s "$PROD_URL/api/youtube/auth/callback?error=access_denied" \
  -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "3️⃣ Проверяем environment detection..."
curl -s "$PROD_URL/api/server/info" \
  -w "\nHTTP Status: %{http_code}\n" | head -200

echo ""
echo "✅ Проверка завершена"
echo "💡 Смотрите логи продакшена для деталей конфигурации YouTube"