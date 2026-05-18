#!/bin/bash
# Quick fix for production Directus URL

echo "=== Quick Fix for Production Directus URL ==="

# Check if we're on production server
if [[ ! -d "/root/smm" ]]; then
    echo "Error: This script should be run on production server"
    exit 1
fi

cd /root/smm

# Add VITE_DIRECTUS_URL to .env if not exists
if ! grep -q "VITE_DIRECTUS_URL" .env; then
    echo "Adding VITE_DIRECTUS_URL to .env..."
    echo 'VITE_DIRECTUS_URL="https://directus.nplanner.ru"' >> .env
    echo "✓ Added VITE_DIRECTUS_URL"
else
    echo "✓ VITE_DIRECTUS_URL already exists"
fi

# Update client/src/lib/directus.ts with correct fallback
echo "Fixing client/src/lib/directus.ts..."
sed -i "s|'http://localhost:8055'|'https://directus.nplanner.ru'|g" client/src/lib/directus.ts

# Restart SMM container
echo "Restarting SMM container..."
docker-compose restart smm

echo "✓ Production fix complete"

# Wait for restart
sleep 10

# Check health
if curl -s -f https://smm.omemo.tech/health > /dev/null; then
    echo "✓ Application is healthy"
    echo "✓ Available at https://smm.omemo.tech"
else
    echo "⚠ Health check failed, but container might still be starting"
fi