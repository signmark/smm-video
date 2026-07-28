import os
import sys
import json
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import psycopg2

# Add qualification dir to path to import qualify
sys.path.append('/root/experiments/leads_qualification')
from qualify import load_env, get_db_connection, qualify_comment_with_llm

load_env()

def enrich_single_lead(lead_id, comment_text, post_text, post_title):
    try:
        # Re-use the existing LLM function from qualify.py
        result = qualify_comment_with_llm(comment_text, post_text, post_title)
        target_product = result.get('target_product', 'Не определено')
        needs = result.get('needs', [])
        
        # Open thread-safe database connection for this thread
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE leads_qualification 
            SET target_product = %s,
                extracted_needs = %s
            WHERE id = %s
        ''', (target_product, json.dumps(needs), lead_id))
        conn.commit()
        cursor.close()
        conn.close()
        return lead_id, target_product, True, None
    except Exception as e:
        return lead_id, None, False, str(e)

def main():
    parser = argparse.ArgumentParser(description='Enrich historical qualified leads with target_product')
    parser.add_argument('--workers', type=int, default=15, help='Number of parallel worker threads')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of leads to enrich')
    args = parser.parse_args()

    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Query leads that are qualified but missing target_product
    query = """
        SELECT l.id, l.comment_text, t.post, t.title 
        FROM leads_qualification l
        LEFT JOIN campaign_trend_topics t ON (CASE WHEN l.post_id ~ '^[0-9a-fA-F-]{36}$' THEN l.post_id::uuid ELSE NULL END) = t.id
        WHERE l.qualification_status IN ('hot', 'warm', 'cold')
          AND (l.target_product IS NULL OR l.target_product = 'Не определено' OR l.target_product = '')
        ORDER BY l.id DESC
    """
    if args.limit:
        query += f" LIMIT {args.limit}"
        
    cursor.execute(query)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    
    total = len(rows)
    print(f"🎯 Found {total} qualified leads needing enrichment.")
    if total == 0:
        print("Nothing to enrich!")
        return

    print(f"🚀 Starting enrichment using {args.workers} parallel workers...")
    
    completed = 0
    success_count = 0
    failed_count = 0
    
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(enrich_single_lead, row_id, comment_text, post_text, post_title): row_id
            for row_id, comment_text, post_text, post_title in rows
        }
        
        for future in as_completed(futures):
            lead_id, target_product, success, err = future.result()
            completed += 1
            if success:
                success_count += 1
                # Periodically print progress
                if completed % 10 == 0 or completed == total:
                    elapsed = time.time() - start_time
                    speed = completed / elapsed if elapsed > 0 else 0
                    eta = (total - completed) / speed if speed > 0 else 0
                    print(f"📈 Progress: {completed}/{total} ({completed/total*100:.1f}%) | "
                          f"Success: {success_count} | Failed: {failed_count} | "
                          f"Speed: {speed:.1f} leads/sec | ETA: {eta:.0f}s")
            else:
                failed_count += 1
                print(f"❌ Failed to enrich lead ID {lead_id}: {err}")
                
    elapsed_total = time.time() - start_time
    print(f"\n✅ Enrichment finished in {elapsed_total:.1f}s!")
    print(f"📊 Total processed: {total}")
    print(f"   Success: {success_count}")
    print(f"   Failed: {failed_count}")

if __name__ == '__main__':
    main()
