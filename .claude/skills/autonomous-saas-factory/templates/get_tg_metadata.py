import urllib.request
import re
import sys
import json

def get_tg_metadata(username_or_url):
    username = username_or_url.split('/')[-1].replace('@', '')
    url = f"https://t.me/{username}"
    
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')
            
            # Extract og:title
            title_match = re.search(r'<meta[^>]*property="og:title"[^>]*content="([^"]*)"', html)
            if not title_match:
                title_match = re.search(r'<meta[^>]*content="([^"]*)"[^>]*property="og:title"', html)
            title = title_match.group(1) if title_match else username
            
            # Extract og:description
            desc_match = re.search(r'<meta[^>]*property="og:description"[^>]*content="([^"]*)"', html)
            if not desc_match:
                desc_match = re.search(r'<meta[^>]*content="([^"]*)"[^>]*property="og:description"', html)
            desc = desc_match.group(1) if desc_match else "No description"
            
            # Extract subscribers/members count from tgme_page_extra
            extra_match = re.search(r'<div[^>]*class="tgme_page_extra"[^>]*>(.*?)</div>', html, re.DOTALL)
            extra = extra_match.group(1).strip() if extra_match else ""
            extra = re.sub(r'<[^>]*>', '', extra).strip() # Clean HTML tags
            
            return {
                "success": True,
                "username": username,
                "title": title,
                "description": desc,
                "extra_info": extra
            }
    except Exception as e:
        return {
            "success": False,
            "username": username,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get_tg_metadata.py <username_or_url>")
        sys.exit(1)
        
    res = get_tg_metadata(sys.argv[1])
    print(json.dumps(res, indent=2, ensure_ascii=False))
