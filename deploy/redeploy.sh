#!/bin/bash

# Stop existing containers
echo "Stopping containers..."
docker-compose down

# Prune build cache to force a fresh build of the smm container
echo "Pruning build cache..."
docker system prune -f

# Build and start containers in detached mode
echo "Building and starting containers..."
docker-compose up -d --build

# Fix docker socket permissions (often needed for Traefik/Portainer/etc)
echo "Fixing docker.sock permissions..."
chmod 666 /var/run/docker.sock

# Wait a moment for containers to initialize
echo "Waiting for services to initialize (10s)..."
sleep 10

# Check running containers
echo "Checking container status..."
docker ps

# Display nginx and smm logs to verify successful startup
echo "Checking nginx logs..."
docker logs nginx
echo "Checking smm logs..."
docker logs smm
