#!/bin/bash
# Подтянуть репо и запустить стек
# Структура: репо в smm/, compose в родителе ИЛИ в корне репо
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO" && git pull

# --force-recreate: пересоздаём контейнеры даже если конфиг не изменился.
# Это критично при изменении docker-compose.yml (сети, метки Traefik, env-переменные) —
# без этого флага контейнеры остаются на старой сети и Traefik не видит их (→ 404).
COMPOSE_FLAGS="-d --build --force-recreate --remove-orphans"

# compose в родителе (структура: parent/smm/, full stack)
if [ -f "$REPO/../docker-compose.yml" ]; then
  echo "[run.sh] Используем compose из родительской директории: $REPO/.."
  cd "$REPO/.." && docker-compose up $COMPOSE_FLAGS
# compose в корне репо
elif [ -f "$REPO/docker-compose.yml" ]; then
  echo "[run.sh] Используем compose из корня репо: $REPO"
  cd "$REPO" && docker-compose up $COMPOSE_FLAGS
# single-container (production) — context: . т.е. из репо
elif [ -f "$REPO/docker-compose.production.yml" ]; then
  echo "[run.sh] Используем docker-compose.production.yml"
  cd "$REPO" && docker-compose -f docker-compose.production.yml up $COMPOSE_FLAGS
else
  echo "[run.sh] ERROR: Не найден docker-compose.yml или docker-compose.production.yml"
  exit 1
fi
