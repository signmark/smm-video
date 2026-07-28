import os
import json
import argparse
from typing import List, Dict, Optional
import psycopg2

# PostgreSQL Leads Qualification CLI with Multi-Provider Fallback and Keyword Pre-filtering
# Supports robust error handling, database unique constraints, and Pydantic-like JSON output.

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

def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('PG_HOST', '172.18.0.3'),
        database=os.getenv('PG_DATABASE', 'directus'),
        user=os.getenv('PG_USER', 'postgres'),
        password=os.getenv('PG_PASSWORD'),
        port=os.getenv('PG_PORT', '5432')
    )

def add_comment(
    source_platform: str,
    channel_id: str,
    post_id: str,
    comment_id: str,
    user_id: str,
    username: Optional[str],
    first_name: Optional[str],
    comment_text: str
) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO leads_qualification (
                source_platform, channel_id, post_id, comment_id, 
                user_id, username, first_name, comment_text, qualification_status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
        ''', (source_platform, channel_id, post_id, comment_id, user_id, username, first_name, comment_text))
        conn.commit()
        return True
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def qualify_comment_with_llm(comment_text: str) -> Dict:
    prompt = f'''
    You are an expert sales lead qualification assistant. 
    Analyze the following customer comment left on a social media channel (Telegram, etc.) and qualify it.
    
    CRITERIA:
    - "hot": The user is explicitly asking to buy, asking for price, or wanting to order immediately.
    - "warm": The user has high interest, asks relevant questions about features, integration, or expresses a problem that our product solves.
    - "cold": The user is just expressing general appreciation (e.g., "cool", "thanks", "great post") or asking very generic, non-purchase-related questions.
    - "trash": Spam, flood, hate, or completely irrelevant text.
    
    Comment text to analyze:
    "{comment_text}"
    
    You must output a JSON object matching this schema. Write the "reason" and "needs" in Russian:
    {{
      "status": "hot" | "warm" | "cold" | "trash",
      "reason": "1-2 sentences explanation in Russian",
      "needs": ["extracted pain 1 in Russian", "extracted pain 2 in Russian", ...]
    }}
    '''

    # 1. Try OpenRouter (Highly robust & cost-effective)
    openrouter_key = os.getenv('OPENROUTER_API_KEY')
    if openrouter_key:
        try:
            import requests
            headers = {
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "google/gemini-2.5-flash",
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "response_format": {"type": "json_object"}
            }
            res = requests.post("https://openrouter.ai/api/v1/chat/completions", json=payload, headers=headers, timeout=15)
            if res.status_code == 200:
                content = res.json()["choices"][0]["message"]["content"]
                return json.loads(content)
            else:
                print(f"⚠️ OpenRouter status code: {res.status_code}. Details: {res.text}")
        except Exception as e:
            print(f"⚠️ OpenRouter qualification failed: {e}. Trying fallback...")

    # 2. Try OpenAI Fallback
    openai_key = os.getenv('OPENAI_API_KEY')
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            print(f"⚠️ OpenAI qualification failed: {e}. Trying fallback...")

    # 3. Try Direct Gemini API (using fallback model name)
    gemini_key = os.getenv('GOOGLE_API_KEY')
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel('gemini-1.5-pro-latest')
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"⚠️ Direct Gemini qualification failed: {e}")

    raise RuntimeError("All LLM qualification providers failed or were not configured.")

def process_pending_leads(limit: int = 100, prefilter: bool = False):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT id, comment_text FROM leads_qualification WHERE qualification_status = 'pending'"
    
    if prefilter:
        # NOTE: Double-percent (%%) is required in psycopg2 to prevent "tuple index out of range" interpolation errors!
        query += """ AND (
            comment_text LIKE '%%?%%' OR 
            comment_text ILIKE '%%цена%%' OR 
            comment_text ILIKE '%%сколько%%' OR 
            comment_text ILIKE '%%купить%%' OR 
            comment_text ILIKE '%%как%%' OR 
            comment_text ILIKE '%%где%%' OR 
            comment_text ILIKE '%%интеграц%%' OR 
            comment_text ILIKE '%%поддержив%%'
        )"""
        
    query += " ORDER BY id DESC LIMIT %s"
    
    cursor.execute(query, (limit,))
    rows = cursor.fetchall()
    
    if not rows:
        print('No pending leads to qualify matching the criteria.')
        cursor.close()
        conn.close()
        return
        
    print(f'Found {len(rows)} pending comment(s) for qualification.')
    
    for row_id, comment_text in rows:
        print(f'Qualifying lead ID {row_id}...')
        try:
            result = qualify_comment_with_llm(comment_text)
            status = result.get('status', 'cold')
            reason = result.get('reason', '')
            needs = json.dumps(result.get('needs', []))
            raw_response = json.dumps(result)
            
            cursor.execute('''
                UPDATE leads_qualification 
                SET qualification_status = %s,
                    qualification_reason = %s,
                    extracted_needs = %s,
                    raw_api_response = %s
                WHERE id = %s
            ''', (status, reason, needs, raw_response, row_id))
            conn.commit()
            print(f'✓ Lead ID {row_id} qualified as "{status.upper()}"')
        except Exception as e:
            print(f'❌ Failed to qualify lead ID {row_id}: {e}')
            
    cursor.close()
    conn.close()

def show_stats():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT qualification_status, COUNT(*) 
        FROM leads_qualification 
        GROUP BY qualification_status
    ''')
    rows = cursor.fetchall()
    print('\n=== Qualification Stats ===')
    for status, count in rows:
        print(f'{status.upper()}: {count}')
    cursor.close()
    conn.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Leads Qualification CLI')
    subparsers = parser.add_subparsers(dest='command')
    
    # Add comment parser
    add_parser = subparsers.add_parser('add')
    add_parser.add_argument('--platform', default='telegram')
    add_parser.add_argument('--channel', required=True)
    add_parser.add_argument('--post', required=True)
    add_parser.add_argument('--comment', required=True)
    add_parser.add_argument('--user-id', required=True)
    add_parser.add_argument('--username', default='')
    add_parser.add_argument('--first-name', default='')
    add_parser.add_argument('--text', required=True)
    
    # Run qualification parser
    run_parser = subparsers.add_parser('run')
    run_parser.add_argument('--limit', type=int, default=100, help='Max comments to qualify in this run')
    run_parser.add_argument('--prefilter', action='store_true', help='Only qualify comments that look like leads (keywords/questions)')
    
    subparsers.add_parser('stats')
    
    args = parser.parse_args()
    
    if args.command == 'add':
        success = add_comment(
            args.platform, args.channel, args.post, args.comment,
            args.user_id, args.username, args.first_name, args.text
        )
        if success:
            print(f'✓ Comment {args.comment} added successfully to queue.')
        else:
            print(f'ℹ Comment {args.comment} already exists in DB.')
            
    elif args.command == 'run':
        process_pending_leads(limit=args.limit, prefilter=args.prefilter)
        show_stats()
        
    elif args.command == 'stats':
        show_stats()
        
    else:
        parser.print_help()
