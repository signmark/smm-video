#!/bin/bash
# Диагностика 404 на проде — запустить на сервере

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 1. Какой compose используется ==="
ls -la docker-compose*.yml 2>/dev/null || echo "Нет compose в текущей папке"
pwd

echo ""
echo "=== 2. Контейнеры и их сети ==="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

echo ""
echo "=== 3. Сеть proxy — кто подключён ==="
docker network inspect proxy 2>/dev/null | grep -A2 '"Name"' || echo "Сеть proxy не найдена"

echo ""
echo "=== 4. Traefik в сети proxy? ==="
docker network inspect proxy 2>/dev/null | grep -E '"traefik"|"smm"|"directus"' || true

echo ""
echo "=== 5. Прямая проверка SMM (внутри хоста) ==="
SMM_CONTAINER=$(docker ps -q -f "name=smm" | head -1)
if [ -n "$SMM_CONTAINER" ]; then
  docker exec "$SMM_CONTAINER" curl -sf -o /dev/null -w "SMM /health: %{http_code}\n" http://localhost:5000/health 2>/dev/null || echo "SMM не отвечает"
else
  echo "SMM контейнер не найден"
fi

echo ""
echo "=== 6. Прямая проверка Directus ==="
DIRECTUS_CONTAINER=$(docker ps -q -f "name=directus" | head -1)
if [ -n "$DIRECTUS_CONTAINER" ]; then
  docker exec "$DIRECTUS_CONTAINER" wget -qO- -o /dev/null http://localhost:8055/server/health 2>/dev/null && echo "Directus: OK" || \
  docker exec "$DIRECTUS_CONTAINER" curl -sf http://localhost:8055/server/health 2>/dev/null && echo "Directus: OK" || echo "Directus: не отвечает"
else
  echo "Directus контейнер не найден"
fi

echo ""
echo "=== 7. Traefik видит роутеры? ==="
curl -s http://localhost:8080/api/http/routers 2>/dev/null | head -100 || echo "Traefik API на :8080 недоступен (добавьте ports: 8080:8080 для отладки)"

echo ""
echo "=== 7b. Кто слушает 80/443? ==="
ss -tlnp 2>/dev/null | grep -E ':80 |:443 ' || netstat -tlnp 2>/dev/null | grep -E ':80 |:443 ' || true

echo ""
echo "=== 8. Внешние проверки (с сервера) ==="
for url in "https://smm.omemo.tech/health" "https://directus.nplanner.ru/server/health" "https://directus.omemo.tech/server/health"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "ERR")
  echo "$url -> $code"
done

echo ""
echo "=== 9. Логи Traefik (последние) ==="
TRAEFIK_CONTAINER=$(docker ps -q -f "name=traefik" | head -1)
if [ -n "$TRAEFIK_CONTAINER" ]; then
  docker logs "$TRAEFIK_CONTAINER" --tail 30 2>&1
else
  echo "Traefik контейнер не найден"
fi
