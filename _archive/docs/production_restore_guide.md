# Production Database Restoration Guide

## Current Status
System is currently running with sample data created after the previous data loss incident. The production backup from June 5, 2025 contains the real user data and campaigns.

## Manual Restoration Steps

### Step 1: Download Production Backup
On your local machine or production server, download the backup:
```bash
# From production server
scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./
```

### Step 2: Upload to Replit
Upload the `all_databases_20250605_111645.sql` file to this Replit project directory.

### Step 3: Run Restoration Script
Execute one of the prepared restoration scripts:
```bash
chmod +x simple_restore.sh
./simple_restore.sh
```

## What the Restoration Will Do
1. Stop all services
2. Recreate the Directus database
3. Filter out N8N conflicts from the backup
4. Restore only Directus-related data
5. Restart all services
6. Verify the restoration

## Expected Results
After restoration, you should have:
- All real user accounts from production
- Actual campaigns and content
- Business questionnaires
- API configurations
- User roles and permissions

## Backup Files Available
- `all_databases_20250605_111645.sql` (Recommended - contains stable data)
- `all_databases_20250606_020001.sql`
- `all_databases_20250607_020001.sql`
- `all_databases_20250608_020001.sql`

The June 5th backup is recommended as it predates the recent issues and contains stable production data.