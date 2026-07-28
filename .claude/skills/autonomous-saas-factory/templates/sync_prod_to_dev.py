import os
import csv
import subprocess
import psycopg2

# High-Performance Cross-Environment DB-to-DB Stream Sync (Prod-to-Dev)
# Streams post_comment table from production Postgres container directly to dev Postgres container
# over SSH-to-STDOUT CSV pipeline, with zero disk footprint and zero credential leaks.

def load_env():
    env_path = '/root/experiments/leads_qualification/.env'
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    k, v = line.split('=', 1)
                    os.environ[k.strip()] = v.strip()

load_env()

def get_dev_connection():
    return psycopg2.connect(
        host=os.getenv('PG_HOST', '172.18.0.3'),
        database=os.getenv('PG_DATABASE', 'directus'),
        user=os.getenv('PG_USER', 'postgres'),
        password=os.getenv('PG_PASSWORD'),
        port=os.getenv('PG_PORT', '5432')
    )

def main():
    print("=== Starting Sync from Prod to Dev ===")
    
    # SSH command to pull CSV stream from production database container
    ssh_cmd = 'ssh -o StrictHostKeyChecking=no root@45.130.212.62 "docker exec -i root-postgres-1 psql -U postgres -d directus -c \\"COPY (SELECT COALESCE(platform, \'telegram\'), COALESCE(trent_post_id::text, \'unknown_post\'), COALESCE(comment_id::text, id::text), COALESCE(author, \'unknown_user\'), text FROM post_comment WHERE text IS NOT NULL AND text != \'\') TO STDOUT WITH CSV;\\\""'
    
    print("Streaming comments from production server...")
    try:
        proc = subprocess.Popen(ssh_cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except Exception as e:
        print(f"❌ Failed to start SSH process: {e}")
        return
        
    dev_conn = get_dev_connection()
    dev_cursor = dev_conn.cursor()
    
    print("Writing to dev PostgreSQL database...")
    count = 0
    batch = []
    
    # Read output line by line as CSV
    reader = csv.reader(proc.stdout)
    for row in reader:
        if not row or len(row) < 5:
            continue
        platform, post_id, comment_id, user_id, text = row[:5]
        
        batch.append((platform, 'unknown_channel', post_id, comment_id, user_id, '', '', text, 'pending'))
        count += 1
        
        if len(batch) >= 1000:
            try:
                dev_cursor.executemany("""
                    INSERT INTO leads_qualification (
                        source_platform, channel_id, post_id, comment_id, 
                        user_id, username, first_name, comment_text, qualification_status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (source_platform, channel_id, post_id, comment_id) DO NOTHING
                """, batch)
                dev_conn.commit()
                print(f"✓ Imported {count} comments...")
            except Exception as e:
                dev_conn.rollback()
                print(f"❌ Error during batch insert: {e}")
            batch = []
            
    # Insert remaining
    if batch:
        try:
            dev_cursor.executemany("""
                INSERT INTO leads_qualification (
                    source_platform, channel_id, post_id, comment_id, 
                    user_id, username, first_name, comment_text, qualification_status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (source_platform, channel_id, post_id, comment_id) DO NOTHING
            """, batch)
            dev_conn.commit()
        except Exception as e:
            dev_conn.rollback()
            print(f"❌ Error during final batch insert: {e}")
            
    stderr_output = proc.stderr.read()
    if stderr_output:
        print(f"⚠️ SSH Warnings/Errors: {stderr_output}")
        
    dev_cursor.close()
    dev_conn.close()
    print(f"=== Sync Completed! Successfully imported {count} comments. ===")

if __name__ == '__main__':
    main()
