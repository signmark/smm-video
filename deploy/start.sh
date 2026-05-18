#!/bin/bash

# ===========================================
# SMM Stack - One-Click Deploy Script
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ===========================================
# Step 1: Pre-flight checks
# ===========================================
log_info "Starting deployment..."

# Check if .env exists, при необходимости копируем из родительской папки
if [ ! -f ".env" ] || [ ! -s ".env" ]; then
    if [ -f "../.env" ]; then
        log_info "Copying ../.env to .env"
        cp ../.env .env
    elif [ ! -f ".env" ]; then
        log_error ".env file not found!"
        log_info "Copy: cp ../.env .env   or   cp .env.example .env"
        exit 1
    fi
fi

# Load .env
log_info "Loading .env from $(pwd)/.env"
set -a
source .env 2>/dev/null || true
set +a

# Fallback: DIRECTUS_DB_PASSWORD = POSTGRES_PASSWORD если не задан
if [ -z "$DIRECTUS_DB_PASSWORD" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    export DIRECTUS_DB_PASSWORD="$POSTGRES_PASSWORD"
fi

# Check required env vars (DIRECTUS_SECRET не требуется — Directus использует random)
log_info "Checking required environment variables..."
REQUIRED_VARS=(
    "POSTGRES_PASSWORD"
    "SSL_EMAIL"
    "DIRECTUS_DB_PASSWORD"
    "DIRECTUS_ADMIN_EMAIL"
    "DIRECTUS_ADMIN_PASSWORD"
    "BEGET_S3_ACCESS_KEY"
    "BEGET_S3_SECRET_KEY"
    "BEGET_S3_BUCKET"
)
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] || [ "${!var}" == "your-"* ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    log_error "Missing or placeholder environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    log_info "Edit .env file and set real values"
    exit 1
fi
log_success "Environment variables OK"

# ===========================================
# Step 2: Clean up port conflicts
# ===========================================
log_info "Checking for port conflicts on 80 and 443..."

# Find processes using ports 80 and 443
for PORT in 80 443; do
    PID=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        log_warn "Port $PORT is in use by PID: $PID"
        PROC_NAME=$(ps -p $PID -o comm= 2>/dev/null || echo "unknown")
        log_info "Process: $PROC_NAME"
    fi
done

# ===========================================
# Step 3: Stop existing containers
# ===========================================
log_info "Stopping existing containers..."

# Stop containers from this project
docker-compose down --remove-orphans 2>/dev/null || true

# Kill any zombie containers using our ports
log_info "Cleaning up zombie containers..."
CONTAINERS_ON_80=$(docker ps -q --filter "publish=80" 2>/dev/null || true)
CONTAINERS_ON_443=$(docker ps -q --filter "publish=443" 2>/dev/null || true)

if [ -n "$CONTAINERS_ON_80" ]; then
    log_warn "Stopping containers on port 80: $CONTAINERS_ON_80"
    docker stop $CONTAINERS_ON_80 2>/dev/null || true
fi

if [ -n "$CONTAINERS_ON_443" ]; then
    log_warn "Stopping containers on port 443: $CONTAINERS_ON_443"
    docker stop $CONTAINERS_ON_443 2>/dev/null || true
fi

log_success "Cleanup complete"

# ===========================================
# Step 4: Ensure networks exist
# ===========================================
log_info "Creating Docker networks..."
docker network create proxy 2>/dev/null || log_info "Network 'proxy' already exists"
docker network create backend 2>/dev/null || log_info "Network 'backend' already exists"
log_success "Networks ready"

# ===========================================
# Step 5: Create required directories
# ===========================================
log_info "Creating data directories..."
mkdir -p traefik_data postgres_data pgadmin_data directus_data n8n_data local-files smm_uploads smm_logs smmniap_static

# Set permissions for traefik acme.json
if [ ! -f "traefik_data/acme.json" ]; then
    touch traefik_data/acme.json
fi
chmod 600 traefik_data/acme.json

log_success "Directories ready"

# ===========================================
# Step 6: Build and start services
# ===========================================
log_info "Building and starting services..."
docker-compose up -d --build

# ===========================================
# Step 7: Wait for services and health check
# ===========================================
log_info "Waiting for services to start (30s)..."
sleep 10

# Show container status
echo ""
log_info "Container status:"
docker-compose ps

# ===========================================
# Step 8: Health checks
# ===========================================
echo ""
log_info "Running health checks..."

check_service() {
    local name=$1
    local url=$2
    local expected=$3

    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

    if [ "$STATUS" == "$expected" ] || [ "$STATUS" == "200" ] || [ "$STATUS" == "302" ]; then
        log_success "$name: HTTP $STATUS"
        return 0
    else
        log_warn "$name: HTTP $STATUS (expected $expected)"
        return 1
    fi
}

sleep 20

echo ""
log_info "Checking services (this may take a moment for SSL cert generation)..."

# Internal health checks first
docker exec smm curl -sf http://localhost:5000/health >/dev/null 2>&1 && log_success "SMM internal: healthy" || log_warn "SMM internal: not ready"
docker exec directus wget -qO- http://localhost:8055/server/health >/dev/null 2>&1 && log_success "Directus internal: healthy" || log_warn "Directus internal: not ready"

echo ""
log_info "External endpoints (requires DNS to be configured):"
check_service "omemo.tech" "https://omemo.tech" "200" || true
check_service "smm.omemo.tech" "https://smm.omemo.tech/health" "200" || true
check_service "directus.omemo.tech" "https://directus.omemo.tech" "200" || true

# ===========================================
# Step 9: Show logs for debugging
# ===========================================
echo ""
log_info "Recent logs from key services:"
echo ""
echo "--- Traefik ---"
docker logs traefik --tail 10 2>&1 | head -15
echo ""
echo "--- SMM ---"
docker logs smm --tail 10 2>&1 | head -15

# ===========================================
# Done
# ===========================================
echo ""
echo "=========================================="
log_success "Deployment complete!"
echo "=========================================="
echo ""
echo "Services:"
echo "  - Frontend:  https://omemo.tech"
echo "  - SMM API:   https://smm.omemo.tech"
echo "  - Directus:  https://directus.omemo.tech"
echo "  - n8n:       https://n8n.omemo.tech"
echo "  - PgAdmin:   https://pgadmin.omemo.tech"
echo "  - Traefik:   https://traefik.omemo.tech"
echo ""
echo "Useful commands:"
echo "  ./logs.sh              # Follow all logs"
echo "  ./logs.sh smm          # SMM logs only"
echo "  ./status.sh            # Check status"
echo "  docker-compose restart smm  # Restart SMM"
echo "  ./stop.sh                                                   # Stop all services"
echo ""
