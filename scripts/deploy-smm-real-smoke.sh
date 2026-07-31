#!/usr/bin/env bash
#
# Real-Docker smoke для scripts/deploy-smm.sh (AI-50).
#
# Проверяет НАСТОЯЩИЕ docker-семантики, которые фейк подменял:
# build -> tag <sha> -> переключение алиаса -> force-recreate -> rollback.
#
# Полностью изолирован от прода:
#  - свой image prefix ai50-smoke:* (боевой root-smm:* не трогается)
#  - свой compose-проект (каталог ai50smoke) и свой compose-файл
#  - свой сервис/контейнер ai50smokeapp (боевой smm не трогается)
#  - порт только на 127.0.0.1:18099, наружу ничего не публикуется
#  - traefik/Directus/postgres/n8n в проекте отсутствуют
#
# Чистит за собой всё, что создал.

set -Eeuo pipefail

ROOT="$(mktemp -d /tmp/ai50-smoke-XXXXXX)"
PROJ="$ROOT/ai50smoke"
ORIGIN="$ROOT/origin.git"
WORK="$ROOT/work"
AUTHOR="$ROOT/authoring"
IMG=ai50-smoke
SVC=ai50smokeapp
PORT=18099

ok()   { printf '  ok   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; FAILED=1; }
FAILED=0

cleanup() {
  docker compose -f "$PROJ/docker-compose.yml" down --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$SVC" >/dev/null 2>&1 || true
  for t in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${IMG}:" || true); do
    docker rmi -f "$t" >/dev/null 2>&1 || true
  done
  rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$PROJ" "$AUTHOR"

# --- изолированный compose-проект -----------------------------------------
cat > "$PROJ/docker-compose.yml" <<YML
services:
  $SVC:
    image: ${IMG}:deployed
    container_name: $SVC
    ports:
      - "127.0.0.1:${PORT}:80"
YML

# --- крошечное приложение, отдающее /health с revision ---------------------
git init --bare -b main "$ORIGIN" >/dev/null
git clone "$ORIGIN" "$AUTHOR" >/dev/null 2>&1
cd "$AUTHOR"
git config user.email t@t; git config user.name T

# nginx:alpine, а не alpine: он уже есть на хосте (сеть при сборке не нужна), и
# в базовом busybox alpine нет апплета httpd — первая версия смоука на этом и
# споткнулась.
cat > Dockerfile <<'DOCKER'
FROM nginx:alpine
ARG APP_COMMIT_SHA=unknown
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
LABEL org.opencontainers.image.revision=$APP_COMMIT_SHA
# Файл пишется на сборке: SHA известен из build-arg.
RUN printf '{"status":"healthy","revision":"%s"}' "$APP_COMMIT_SHA" > /usr/share/nginx/html/health
DOCKER
echo v1 > app.txt
git add -A >/dev/null; git commit -qm v1; git push -q origin main
cd /; git clone "$ORIGIN" "$WORK" >/dev/null 2>&1
SHA1="$(git -C "$WORK" rev-parse origin/main)"

export SMM_REPO_DIR="$WORK"
export SMM_COMPOSE_FILE="$PROJ/docker-compose.yml"
export SMM_LOCK_FILE="$ROOT/lock"
export SMM_WORKTREE_BASE="$ROOT/wt"
export SMM_IMAGE_REPO="$IMG"
export SMM_DEPLOYED_TAG="${IMG}:deployed"
export SMM_SERVICE="$SVC"
export SMM_CONTAINER="$SVC"
export SMM_HEALTH_URL="http://127.0.0.1:${PORT}/health"
export SMM_PUBLIC_URL="http://127.0.0.1:${PORT}/health"
export SMM_HEALTH_RETRIES=30
export SMM_HEALTH_DELAY=1

DEPLOY=/root/smm/scripts/deploy-smm.sh

echo "=== 1. первый деплой (настоящие build/tag/up) ==="
if "$DEPLOY" >"$ROOT/d1.log" 2>&1; then ok "деплой SHA1 прошёл"; else bad "деплой SHA1: $(tail -3 "$ROOT/d1.log")"; fi

[ -n "$(docker images -q "${IMG}:${SHA1}")" ] && ok "образ ${IMG}:${SHA1} создан" || bad "нет образа по SHA"
[ "$(docker image inspect "${IMG}:deployed" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SHA1" ] \
  && ok "алиас deployed указывает на SHA1" || bad "алиас не на SHA1"
[ "$(docker inspect "$SVC" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SHA1" ] \
  && ok "контейнер запущен из SHA1" || bad "контейнер не из SHA1"
[ "$(curl -s "http://127.0.0.1:${PORT}/health" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')" = "$SHA1" ] \
  && ok "/health.revision = SHA1" || bad "/health.revision не SHA1"

CID1="$(docker inspect "$SVC" --format '{{.Id}}')"

echo "=== 2. второй деплой (force-recreate на новый SHA) ==="
cd "$AUTHOR"; echo v2 > app.txt; git add -A >/dev/null; git commit -qm v2; git push -q origin main
SHA2="$(git -C "$AUTHOR" rev-parse HEAD)"
cd /
if "$DEPLOY" >"$ROOT/d2.log" 2>&1; then ok "деплой SHA2 прошёл"; else bad "деплой SHA2: $(tail -3 "$ROOT/d2.log")"; fi

CID2="$(docker inspect "$SVC" --format '{{.Id}}')"
[ "$CID1" != "$CID2" ] && ok "контейнер действительно пересоздан" || bad "контейнер не пересоздан"
[ "$(curl -s "http://127.0.0.1:${PORT}/health" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')" = "$SHA2" ] \
  && ok "/health.revision = SHA2" || bad "/health.revision не SHA2"

echo "=== 3. откат на SHA1 (настоящий docker tag по образу) ==="
if "$DEPLOY" --rollback "$SHA1" >"$ROOT/d3.log" 2>&1; then ok "откат прошёл"; else bad "откат: $(tail -3 "$ROOT/d3.log")"; fi
[ "$(docker image inspect "${IMG}:deployed" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SHA1" ] \
  && ok "алиас вернулся на SHA1" || bad "алиас не вернулся"
[ "$(curl -s "http://127.0.0.1:${PORT}/health" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p')" = "$SHA1" ] \
  && ok "/health.revision снова SHA1" || bad "/health.revision не откатился"

echo "=== 4. preflight отвергает compose с build: ==="
cat > "$PROJ/docker-compose.yml" <<YML
services:
  $SVC:
    build:
      context: .
    image: ${IMG}:deployed
    container_name: $SVC
YML
if "$DEPLOY" >"$ROOT/d4.log" 2>&1; then bad "preflight пропустил build:"; else
  grep -q "build:" "$ROOT/d4.log" && ok "preflight отверг build: с внятной причиной" || bad "отверг, но без причины"
fi

echo "=== 5. боевые объекты не тронуты ==="
docker ps --format '{{.Names}}' | grep -qx smm && ok "прод-контейнер smm жив" || bad "прод-контейнер smm пропал"
[ -n "$(docker images -q root-smm:latest)" ] && ok "боевой образ root-smm на месте" || bad "боевой образ пропал"

echo
[ "$FAILED" = 0 ] && echo "SMOKE OK" || echo "SMOKE FAILED"
exit "$FAILED"
