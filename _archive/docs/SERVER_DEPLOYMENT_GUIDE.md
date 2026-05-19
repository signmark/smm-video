# SMM Self-Hosted Multi-Server Deployment Guide

## Current Status
- **Replit Environment**: ✅ Fully operational
- **Docker Container**: ✅ Running with correct credentials  
- **New Server (31.128.43.113)**: ❌ SMM app not deployed

## Git-Based Deployment for Production Servers

### Step 1: Navigate to Application Directory
```bash
# On production server
cd /root/smm
git pull origin main
```

### Step 2: Run Deployment Script
```bash
# Make script executable and run
chmod +x deploy_simple.sh
./deploy_simple.sh
```

### Step 3: Verify Deployment
```bash
# Check health endpoint
curl http://localhost:5000/health

# Check application status
docker logs smm-production --tail 20
```

## Environment Configurations

### Production Server (.env)
- Admin: `lbrspb@gmail.com`
- Directus: `https://directus.roboflow.tech`
- Docker optimized settings

### Replit Development (.env)
- Admin: `admin@roboflow.tech` (system override)
- Development mode settings
- Hot reload enabled

## Troubleshooting

### 404 Errors
- Check if Docker container is running: `docker ps | grep smm`
- Verify Nginx proxy configuration
- Check application logs: `docker logs smm-1 -f`

### Authentication Issues
- System uses environment detection for credentials
- Docker environment automatically uses production credentials
- Replit uses development credentials from system variables

### Service Health Check
```bash
# Check container status
docker ps | grep smm-1

# Check application response
curl -I http://localhost:5000

# Check logs
docker logs smm-1 --tail 20
```

## Self-Hosted Architecture

```
Internet (HTTPS/SSL via Let's Encrypt)
    ↓
SMM Application (Docker:5000)
    ├── Frontend (React/Vite)
    ├── Backend (Express.js)
    └── Static Assets
    ↓
Directus API (directus.roboflow.tech)
    ↓
PostgreSQL Database
```

## Deployment Verification

After deployment, verify:
1. `https://smm.roboflow.tech` returns 200/404 (not connection error)
2. Docker container shows in `docker ps`
3. Application logs show successful Directus connection
4. Global API keys loaded (8 keys expected)
5. Content processing active (50+ items)

## Current Working Configuration

The system in Replit shows:
- ✅ Authentication successful with admin@roboflow.tech
- ✅ Processing 50 content items
- ✅ 3 scheduled publications
- ✅ 8 global API keys loaded
- ✅ All background services operational

Transfer this exact configuration to new server using deployment scripts.