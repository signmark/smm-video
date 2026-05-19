#!/usr/bin/env python3

import subprocess
import sys
import os
import time

def run_command(cmd, shell=True):
    """Run command and return output"""
    try:
        result = subprocess.run(cmd, shell=shell, capture_output=True, text=True)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def main():
    print("🔄 Production backup download and restore")
    
    # Step 1: Download backup file
    backup_file = "all_databases_20250605_111645.sql"
    
    if not os.path.exists(backup_file):
        print("📥 Downloading backup file...")
        
        # Try wget first
        success, _, _ = run_command(f"wget --no-check-certificate -q http://31.128.43.113:8080/backup/{backup_file}")
        
        if not success:
            # Try curl
            success, _, _ = run_command(f"curl -k -o {backup_file} http://31.128.43.113:8080/backup/{backup_file}")
            
        if not success:
            print("❌ Could not download backup file automatically")
            print("Please manually download:")
            print(f"scp root@31.128.43.113:/root/backup/{backup_file} ./")
            return False
    
    if not os.path.exists(backup_file):
        print(f"❌ Backup file {backup_file} not found")
        return False
        
    print(f"✅ Found backup file: {os.path.getsize(backup_file)/1024/1024:.1f}MB")
    
    # Step 2: Stop services
    print("⏹️ Stopping services...")
    run_command("docker-compose stop")
    
    # Step 3: Start PostgreSQL
    print("🚀 Starting PostgreSQL...")
    run_command("docker-compose up -d postgres")
    time.sleep(15)
    
    # Step 4: Check PostgreSQL
    success, _, _ = run_command("docker exec root-postgres-1 pg_isready -U postgres")
    if not success:
        print("❌ PostgreSQL not ready")
        return False
    
    # Step 5: Create temp database
    print("🗄️ Creating temporary database...")
    run_command('docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS temp_restore;"')
    run_command('docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE temp_restore;"')
    
    # Step 6: Restore to temp database
    print("📥 Restoring backup to temporary database...")
    success, _, _ = run_command(f"docker exec -i root-postgres-1 psql -U postgres -d temp_restore < {backup_file}")
    
    if not success:
        print("❌ Failed to restore backup")
        return False
    
    # Step 7: Export Directus data
    print("📤 Exporting Directus data...")
    export_cmd = '''docker exec root-postgres-1 pg_dump -U postgres -d temp_restore --schema=public -t "directus_*" -t "business_questionnaire" -t "campaign_*" -t "user_*" -t "global_api_keys" -t "post_comment" -t "source_posts" -t "content_sources"'''
    
    success, directus_data, _ = run_command(export_cmd)
    
    if success and directus_data:
        with open("directus_production.sql", "w") as f:
            f.write(directus_data)
        print(f"📊 Exported {len(directus_data.splitlines())} lines of Directus data")
    else:
        print("❌ Failed to export Directus data")
        return False
    
    # Step 8: Recreate directus database
    print("🗄️ Recreating directus database...")
    run_command('docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS directus;"')
    run_command('docker exec root-postgres-1 psql -U postgres -c "CREATE DATABASE directus;"')
    
    # Step 9: Restore Directus data
    print("📥 Restoring Directus data...")
    success, _, _ = run_command("docker exec -i root-postgres-1 psql -U postgres -d directus < directus_production.sql")
    
    if not success:
        print("❌ Failed to restore Directus data")
        return False
    
    # Step 10: Cleanup
    print("🗑️ Cleaning up...")
    run_command('docker exec root-postgres-1 psql -U postgres -c "DROP DATABASE temp_restore;"')
    
    # Step 11: Start all services
    print("🚀 Starting all services...")
    run_command("docker-compose up -d")
    time.sleep(20)
    
    # Step 12: Verify restoration
    print("🔍 Verifying restoration...")
    success, output, _ = run_command("node check_database_structure.js")
    
    if success:
        print("✅ Database restoration completed successfully")
        print(output)
        return True
    else:
        print("⚠️ Restoration completed but verification failed")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)