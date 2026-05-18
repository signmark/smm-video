# Manual Database Restoration Instructions

## Step 1: Get the backup file
You need to manually copy the backup file from the production server:

```bash
# On your local machine, copy the file from production
scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./
```

## Step 2: Run the restoration script
Once you have the file in the current directory, run:

```bash
chmod +x restore_local_backup.sh
./restore_local_backup.sh
```

The script will:
1. Stop all services
2. Create a temporary database
3. Restore the full backup to the temporary database
4. Extract only Directus data
5. Restore Directus data to the main database
6. Clean up and restart services

## Alternative: If you already have the file locally
If you already downloaded the backup file, just rename it to:
`all_databases_20250605_111645.sql`

And place it in the root directory of this project, then run the restoration script.