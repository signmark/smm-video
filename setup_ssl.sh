#!/bin/bash

# SSL setup script for self-hosted SMM application
# This configures the application to handle SSL directly

set -e

echo "=== SSL Setup for Self-Hosted SMM ==="

DOMAIN=${1:-"smm.roboflow.tech"}
APP_PORT="5000"

# Install certbot if not present
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    apt update
    apt install -y certbot python3-certbot-nginx
fi

# Stop application temporarily for certificate generation
echo "Stopping application for SSL setup..."
docker-compose -f deploy/docker-compose.yml down || true

# Generate certificate using standalone mode
echo "Generating SSL certificate for $DOMAIN..."
certbot certonly --standalone \
    --preferred-challenges http \
    --http-01-port 80 \
    -d $DOMAIN \
    --non-interactive \
    --agree-tos \
    --email admin@roboflow.tech

# Create SSL configuration for the application
echo "Creating SSL configuration..."
mkdir -p /etc/ssl/smm

# Copy certificates to application directory
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/ssl/smm/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/ssl/smm/

# Set proper permissions
chmod 644 /etc/ssl/smm/fullchain.pem
chmod 600 /etc/ssl/smm/privkey.pem

# Update docker-compose to include SSL volumes
if ! grep -q "ssl" deploy/docker-compose.yml; then
    echo "Updating docker-compose for SSL..."
    cat >> deploy/docker-compose.yml << 'EOF'
    volumes:
      - /etc/ssl/smm:/etc/ssl/smm:ro
    environment:
      - SSL_CERT_PATH=/etc/ssl/smm/fullchain.pem
      - SSL_KEY_PATH=/etc/ssl/smm/privkey.pem
      - ENABLE_HTTPS=true
EOF
fi

# Restart application with SSL
echo "Starting application with SSL..."
docker-compose -f deploy/docker-compose.yml up -d

# Setup auto-renewal
echo "Setting up SSL auto-renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet --deploy-hook 'docker-compose -f /root/smm/deploy/docker-compose.yml restart'") | crontab -

echo "✓ SSL setup complete"
echo "✓ Application available at https://$DOMAIN"
echo "✓ Auto-renewal configured"