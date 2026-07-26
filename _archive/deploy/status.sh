#!/bin/bash

# ===========================================
# SMM Stack - Status Script
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "Container Status"
echo "=========================================="
docker-compose ps

echo ""
echo "=========================================="
echo "Resource Usage"
echo "=========================================="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
    $(docker-compose ps -q) 2>/dev/null || echo "No running containers"

echo ""
echo "=========================================="
echo "Port Bindings"
echo "=========================================="
docker-compose ps --format "table {{.Name}}\t{{.Ports}}" 2>/dev/null || \
    docker ps --filter "name=traefik" --filter "name=smm" --filter "name=nginx" --filter "name=directus" --format "table {{.Names}}\t{{.Ports}}"

echo ""
echo "=========================================="
echo "Quick Health Check"
echo "=========================================="

check() {
    local name=$1
    local container=$2
    local cmd=$3

    if docker exec $container sh -c "$cmd" >/dev/null 2>&1; then
        echo "[OK] $name"
    else
        echo "[FAIL] $name"
    fi
}

check "Postgres" "postgres" "pg_isready -U postgres"
check "SMM API" "smm" "curl -sf http://localhost:5000/health"
check "Directus" "directus" "wget -qO- http://localhost:8055/server/health"
check "Nginx" "nginx" "curl -sf http://localhost:80"

echo ""
