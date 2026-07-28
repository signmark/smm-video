import os
import requests
import argparse

# Directus Headless CMS Collection Auto-Registration & Presets Configuration
# Logs into Directus REST API using admin credentials, registers an existing PostgreSQL database table 
# as a collection, and configures beautiful metadata (icons, colors, default tabular list view presets).

def load_credentials(env_path: str):
    email = None
    password = None
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('DIRECTUS_ADMIN_EMAIL='):
                    email = line.split('=', 1)[1].strip().strip('"').strip("'")
                elif line.startswith('DIRECTUS_ADMIN_PASSWORD='):
                    password = line.split('=', 1)[1].strip().strip('"').strip("'")
    return email, password

def main():
    parser = argparse.ArgumentParser(description="Directus Table Auto-Registration")
    parser.add_argument("--env", default="/root/smm_back/.env", help="Path to Directus env file")
    parser.add_argument("--api-url", default="http://172.18.0.5:8055", help="Directus container API URL")
    parser.add_argument("--table", default="leads_qualification", help="Table name to register")
    parser.add_argument("--icon", default="handshake", help="Sidebar icon name")
    parser.add_argument("--color", default="#673AB7", help="Sidebar icon color")
    
    args = parser.parse_args()

    email, password = load_credentials(args.env)
    if not email or not password:
        print(f"❌ Error: Admin credentials not found in {args.env}")
        return
        
    print(f"Logging in to Directus ({args.api_url}) as {email}...")
    
    # 1. Authenticate to obtain access token
    login_url = f"{args.api_url}/auth/login"
    login_payload = {
        "email": email,
        "password": password
    }
    
    try:
        login_res = requests.post(login_url, json=login_payload, timeout=10)
        if login_res.status_code != 200:
            print(f"❌ Failed to login. Status: {login_res.status_code}. Response: {login_res.text}")
            return
    except Exception as e:
        print(f"❌ Error connecting to Directus: {e}")
        return
        
    token = login_res.json()["data"]["access_token"]
    print("✓ Successfully logged in. Registering/updating collection...")
    
    # 2. Register/Update collection metadata
    url = f"{args.api_url}/collections/{args.table}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "collection": args.table,
        "meta": {
            "icon": args.icon,
            "color": args.color,
            "display_template": "{{comment_text}}",
            "show_in_sidebar": True,
            "sort_field": "id"
        },
        "schema": {}
    }
    
    # Check if collection is already registered
    check_res = requests.get(url, headers=headers)
    if check_res.status_code == 200:
        print(f"ℹ Collection '{args.table}' already exists. Updating metadata...")
        res = requests.patch(url, json={"meta": payload["meta"]}, headers=headers)
    else:
        print(f"Creating collection '{args.table}' from database table...")
        res = requests.post(f"{args.api_url}/collections", json=payload, headers=headers)
        
    if res.status_code in (200, 201):
        print(f"🎉 Successfully configured '{args.table}' collection metadata!")
    else:
        print(f"❌ Failed to configure collection. Status: {res.status_code}. Response: {res.text}")
        return
        
    # 3. Create/Update beautiful default tabular layout preset
    print("Configuring default grid columns layout preset...")
    get_preset_url = f"{args.api_url}/presets?filter[collection][_eq]={args.table}"
    get_preset_res = requests.get(get_preset_url, headers=headers)
    presets = get_preset_res.json().get("data", [])
    
    preset_payload = {
        "collection": args.table,
        "layout": "tabular",
        "layout_query": {
            "tabular": {
                "fields": [
                    "id",
                    "qualification_status",
                    "qualification_reason",
                    "comment_text",
                    "username"
                ],
                "sort": ["-id"]
            }
        }
    }
    
    if presets:
        preset_id = presets[0]["id"]
        res = requests.patch(f"{args.api_url}/presets/{preset_id}", json=preset_payload, headers=headers)
    else:
        res = requests.post(f"{args.api_url}/presets", json=preset_payload, headers=headers)
        
    if res.status_code in (200, 201):
        print("🎉 Successfully configured default column preset in Directus!")
    else:
        print(f"⚠️ Warning: Failed to configure default layout preset: {res.text}")

if __name__ == '__main__':
    main()
