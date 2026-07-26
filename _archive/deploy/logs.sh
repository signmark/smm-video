#!/bin/bash

# ===========================================
# SMM Stack - Logs Script
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVICE=${1:-""}

if [ -z "$SERVICE" ]; then
    echo "Following all service logs (Ctrl+C to exit)..."
    echo ""
    docker-compose logs -f --tail 50
else
    echo "Following $SERVICE logs (Ctrl+C to exit)..."
    echo ""
    docker-compose logs -f --tail 100 "$SERVICE"
fi
