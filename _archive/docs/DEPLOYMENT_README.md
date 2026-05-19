# SMM Self-Hosted Deployment Guide

## Quick Start for Production Servers

Your SMM application is designed to self-host everything without requiring Nginx or external web servers.

### 1. Navigate to Application Directory
```bash
cd /root/smm
git pull origin main
```

### 2. Deploy Application
```bash
chmod +x deploy_simple.sh
./deploy_simple.sh
```

### 3. Setup SSL (Optional)
```bash
chmod +x setup_ssl.sh
./setup_ssl.sh smm.roboflow.tech
```

## Application Architecture

```
Internet → SMM Application (Port 5000)
            ├── React Frontend
            ├── Express Backend  
            ├── Static Assets
            └── Health Endpoint (/health)
            ↓
         Directus API (directus.roboflow.tech)
            ↓
         PostgreSQL Database
```

## Environment Detection

The application automatically detects the environment:

- **Production Server** (`/root/smm`): Uses `lbrspb@gmail.com` credentials
- **Replit Development**: Uses `admin@roboflow.tech` credentials
- **Docker Container**: Uses production credentials

## Health Monitoring

Health endpoint available at: `http://localhost:5000/health`

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2025-06-08T16:05:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0"
}
```

## Verification Commands

```bash
# Check application status
docker ps | grep smm-production

# View logs
docker logs smm-production --tail 20

# Test health endpoint
curl http://localhost:5000/health

# Check SSL (if enabled)
curl https://smm.roboflow.tech/health
```

## Troubleshooting

### Application won't start
```bash
# Check Docker logs
docker logs smm-production

# Rebuild container
docker-compose -f deploy/docker-compose.yml build --no-cache
```

### Health check fails
```bash
# Check if port is accessible
netstat -tlnp | grep 5000

# Check application logs
docker logs smm-production --tail 50
```

### SSL issues
```bash
# Check certificate status
certbot certificates

# Renew certificate manually
certbot renew --dry-run
```

## File Structure

```
/root/smm/
├── deploy_simple.sh          # Main deployment script
├── setup_ssl.sh             # SSL configuration
├── deploy/docker-compose.yml
├── deploy/smm/Dockerfile
├── server/
│   ├── index.ts             # Main server file
│   └── utils/
│       └── environment-detector.ts
└── client/                  # Frontend application
```

## Support

- Health endpoint: `/health`
- Application logs: `docker logs smm-production`
- Environment detection: Automatic based on `/root/smm` path
- Credentials: Auto-configured for production environment