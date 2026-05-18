#!/bin/bash

echo "🔄 Quick database restoration"

# Check if backup file exists
if [ ! -f "./all_databases_20250605_111645.sql" ]; then
    echo "❌ Backup file not found"
    echo "Please download it manually:"
    echo "scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./"
    exit 1
fi

echo "✅ Found backup file: $(du -h ./all_databases_20250605_111645.sql | cut -f1)"

# Stop services and start postgres
docker-compose stop
docker-compose up -d postgres
sleep 15

# Recreate directus database
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;"
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;"

# Restore directly to directus (filtering out N8N conflicts)
echo "📥 Restoring backup..."
grep -v "n8n_" ./all_databases_20250605_111645.sql | \
docker exec -i root-postgres-1 psql -U postgres -d directus

# Start all services
docker-compose up -d
sleep 20

echo "✅ Restoration completed"
node check_database_structure.js