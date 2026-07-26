#!/bin/bash

# ===========================================
# SMM Stack - Stop Script
# ===========================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[INFO] Stopping all services..."
docker-compose down

echo "[OK] All services stopped"
echo ""
echo "To remove volumes (DATA LOSS!): docker-compose down -v"
