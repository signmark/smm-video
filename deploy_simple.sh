#!/bin/bash

# Simple deployment script for SMM self-hosted application
# Auto-detects project directory and handles deployment

set -e

echo "=== SMM Simple Deployment ==="

# Fix Directus URL configuration for production
fix_directus_config() {
    local smm_dir="$1"
    echo "Fixing Directus URL configuration..."
    
    # Add VITE_DIRECTUS_URL to .env if missing
    if [ -f "$smm_dir/../.env" ] && ! grep -q "VITE_DIRECTUS_URL" "$smm_dir/../.env"; then
        echo 'VITE_DIRECTUS_URL="https://directus.nplanner.ru"' >> "$smm_dir/../.env"
        echo "✓ Added VITE_DIRECTUS_URL to .env"
    fi
    
    # Fix client code fallback URL
    if [ -f "$smm_dir/client/src/lib/directus.ts" ]; then
        sed -i "s|'http://localhost:8055'|'https://directus.nplanner.ru'|g" "$smm_dir/client/src/lib/directus.ts"
        echo "✓ Fixed client Directus URL fallback"
    fi
}

# Auto-detect project structure
if [ -f "package.json" ] && [ -f "../docker-compose.yml" ]; then
    # We're in the SMM folder, parent has docker-compose.yml
    SMM_DIR=$(pwd)
    PROJECT_ROOT=$(cd .. && pwd)
    echo "SMM project detected in: $SMM_DIR"
    echo "Docker Compose root: $PROJECT_ROOT"
    cd "$PROJECT_ROOT"
elif [ -f "docker-compose.yml" ] && [ -d "smm" ] && [ -f "smm/package.json" ]; then
    # We're in the root with docker-compose.yml
    PROJECT_ROOT=$(pwd)
    SMM_DIR="$PROJECT_ROOT/smm"
    echo "Project root detected: $PROJECT_ROOT"
    echo "SMM folder: $SMM_DIR"
else
    echo "Error: Cannot find SMM project structure"
    echo "Expected: docker-compose.yml in root and smm/package.json"
    exit 1
fi

# Apply Directus configuration fixes
fix_directus_config "$SMM_DIR"

# Stop existing SMM service if running
echo "Stopping existing SMM service..."
docker-compose down smm || true

# Check if required files exist
if [ ! -f "docker-compose.yml" ]; then
    echo "Error: docker-compose.yml not found in $PROJECT_ROOT"
    exit 1
fi

echo "Using main docker-compose.yml with SMM service"

# For production deployment, use the main docker-compose.yml with rebuilt SMM service
echo "Rebuilding SMM service in $PROJECT_ROOT..."
docker-compose build --no-cache smm

echo "Starting SMM service..."
docker-compose up -d smm

# Wait for startup
echo "Waiting for application to start..."
sleep 15

# Check health with retries via Traefik
echo "Checking application health via Traefik..."
for i in {1..6}; do
    if curl -s -f https://smm.omemo.tech/health > /dev/null; then
        echo "✓ Application is healthy"
        echo "✓ Available at https://smm.omemo.tech"
        
        # Show status
        echo "Application status:"
        curl -s https://smm.omemo.tech/health | python3 -m json.tool 2>/dev/null || echo "Health check passed via Traefik"
        
        echo "Container status:"
        docker ps | grep smm
        
        echo "=== Deployment Complete ==="
        exit 0
    else
        echo "Health check attempt $i/6 failed (via Traefik), waiting 10 seconds..."
        sleep 10
    fi
done

echo "✗ Health check failed after 6 attempts"
echo "Container logs:"
docker logs $(docker ps -q -f "name=smm") --tail 30 2>/dev/null || echo "No SMM container found"
echo "Container status:"
docker ps -a | grep smm
exit 1