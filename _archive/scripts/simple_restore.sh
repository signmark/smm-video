#!/bin/bash

echo "Database restoration from production backup"

# Download file using curl if not exists
if [ ! -f "all_databases_20250605_111645.sql" ]; then
    echo "Downloading backup file..."
    curl -k -o all_databases_20250605_111645.sql "https://31.128.43.113:8080/backup/all_databases_20250605_111645.sql" 2>/dev/null || \
    wget --no-check-certificate -O all_databases_20250605_111645.sql "https://31.128.43.113:8080/backup/all_databases_20250605_111645.sql" 2>/dev/null || \
    echo "Please manually place the backup file in this directory and run the script again"
fi

if [ ! -f "all_databases_20250605_111645.sql" ]; then
    echo "Backup file not found. Please download it manually:"
    echo "scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./"
    exit 1
fi

echo "Found backup file: $(ls -lh all_databases_20250605_111645.sql | awk '{print $5}')"

# Stop and restart services
docker-compose stop
docker-compose up -d postgres
sleep 15

# Recreate database
docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;"
docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;"

# Filter and restore only non-N8N data
echo "Restoring filtered backup data..."
grep -v "n8n_" all_databases_20250605_111645.sql | \
sed '/ERROR.*multiple primary keys/d' | \
sed '/ERROR.*already exists/d' | \
docker exec -i root-postgres-1 psql -U postgres -d directus

# Start all services
docker-compose up -d
sleep 20

echo "Restoration completed"
node check_database_structure.js