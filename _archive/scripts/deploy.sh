#!/bin/bash

# Git-based deployment script for SMM self-hosted application
# Run this script on the production server after git pull

set -e

echo "=== SMM Self-Hosted Production Deployment ==="

# Configuration
PROJECT_DIR="/root/smm"
BACKUP_DIR="/root/smm-backups"
COMPOSE_FILE="deploy/docker-compose.yml"
APP_PORT="5000"

# Create backup of current version
if [ -d "$PROJECT_DIR" ]; then
    echo "Creating backup of current version..."
    mkdir -p "$BACKUP_DIR"
    cp -r "$PROJECT_DIR" "$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S)"
fi

# Clone or update repository
if [ ! -d "$PROJECT_DIR" ]; then
    echo "Cloning repository..."
    git clone https://github.com/your-username/smm-project.git "$PROJECT_DIR"
else
    echo "Updating repository..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/main
fi

cd "$PROJECT_DIR"

# Copy environment file for deploy
if [ ! -f "deploy/.env" ] && [ ! -f ".env" ]; then
    echo "Creating deploy/.env file..."
    mkdir -p deploy
    cat > deploy/.env << 'EOF'
# Production environment configuration
DIRECTUS_URL=https://directus.roboflow.tech
DIRECTUS_ADMIN_EMAIL=lbrspb@gmail.com
DIRECTUS_ADMIN_PASSWORD=CHANGE_ME
DIRECTUS_DB_PASSWORD=CHANGE_ME
VITE_DIRECTUS_URL=https://directus.roboflow.tech

NODE_ENV=production
PORT=5000
DOCKER_ENV=true

SESSION_SECRET=smm-secure-session-key-production-2024
DATABASE_URL=postgresql://postgres:CHANGE_ME@localhost:5432/smm_db

LOG_LEVEL=info
DEBUG_SCHEDULER=false
CORS_ORIGIN=https://smm.roboflow.tech,https://directus.roboflow.tech

API_TIMEOUT=30000
DIRECTUS_TIMEOUT=15000
DISABLE_PUBLISHING=false
SCHEDULER_INTERVAL=20000
STATUS_CHECK_INTERVAL=60000
EOF
fi

# Create necessary directories
mkdir -p uploads/temp uploads/images logs

# Stop existing containers
echo "Stopping existing containers..."
docker-compose -f "$COMPOSE_FILE" down 2>/dev/null || true
docker stop smm 2>/dev/null || true
docker rm smm 2>/dev/null || true

# Remove old images
docker image prune -f

# Build and start new containers
echo "Building and starting new containers..."
docker-compose -f "$COMPOSE_FILE" up -d --build

# Wait for startup
echo "Waiting for application startup..."
sleep 30

# Health check
echo "Performing health check..."
if docker ps | grep -q smm; then
    echo "✓ Container is running"
    
    # Check application response via health endpoint
    echo "Testing health endpoint..."
    sleep 5
    
    if docker exec smm curl -s -f "http://localhost:$APP_PORT/health" > /dev/null 2>&1; then
        echo "✓ Health check passed"
        echo "✓ Application is responding on port $APP_PORT"
        echo "✓ Deployment successful"
        
        # Show health status
        docker exec smm curl -s "http://localhost:$APP_PORT/health" | python3 -m json.tool 2>/dev/null || echo "Health endpoint responded"
        
        # Show recent logs
        echo "Recent logs:"
        docker logs smm --tail 10
    else
        echo "✗ Health check failed"
        echo "Testing basic HTTP response..."
        if docker exec smm curl -s -o /dev/null -w "%{http_code}" "http://localhost:$APP_PORT" | grep -q "200\|404"; then
            echo "✓ Basic HTTP response working"
        else
            echo "✗ No HTTP response"
        fi
        docker logs smm --tail 20
        exit 1
    fi
else
    echo "✗ Container failed to start"
    docker logs smm --tail 20
    exit 1
fi

echo "=== Deployment completed successfully ==="
echo "Application available at: https://smm.roboflow.tech"
echo "Monitor logs: docker logs smm -f"