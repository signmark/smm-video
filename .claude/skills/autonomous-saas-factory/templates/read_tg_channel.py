import sys
import re
import json
import httpx
from bs4 import BeautifulSoup
from datetime import datetime

def clean_html_to_markdown(elem):
    """Converts a BeautifulSoup element containing TG post HTML into basic Markdown."""
    if not elem:
        return ""
    
    # Simple recursive helper to replace formatting tags
    for tag in elem.find_all(["b", "strong"]):
        tag.insert_before("**")
        tag.insert_after("**")
        tag.unwrap()
        
    for tag in elem.find_all(["i", "em"]):
        tag.insert_before("*")
        tag.insert_after("*")
        tag.unwrap()
        
    for tag in elem.find_all("code"):
        tag.insert_before("`")
        tag.insert_after("`")
        tag.unwrap()
        
    for tag in elem.find_all("pre"):
        tag.insert_before("\n```\n")
        tag.insert_after("\n```\n")
        tag.unwrap()
        
    for tag in elem.find_all("a"):
        href = tag.get("href")
        text = tag.get_text()
        if href:
            tag.replace_with(f"[{text}]({href})")
        else:
            tag.unwrap()
            
    for br in elem.find_all("br"):
        br.replace_with("\n")
        
    return elem.get_text()

def parse_telegram_channel(channel_username, limit=10):
    url = f"https://t.me/s/{channel_username}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=15)
        if resp.status_code != 200:
            return {"error": f"Failed to fetch channel, HTTP status: {resp.status_code}"}
    except Exception as e:
        return {"error": f"Request failed: {str(e)}"}
        
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # Check if channel exists / is public
    title_elem = soup.find("meta", property="og:title")
    title = title_elem.get("content") if title_elem else channel_username
    
    desc_elem = soup.find("meta", property="og:description")
    description = desc_elem.get("content") if desc_elem else ""
    
    messages = soup.find_all("div", class_="tgme_widget_message")
    parsed_messages = []
    
    for msg in messages:
        # Check if it is a service message or has no post id
        post_id_raw = msg.get("data-post")
        if not post_id_raw:
            continue
            
        post_id = post_id_raw.split("/")[-1]
        post_url = f"https://t.me/{post_id_raw}"
        
        # Date
        date_elem = msg.find("time")
        date_str = None
        if date_elem:
            date_str = date_elem.get("datetime")
            
        # Views
        views_elem = msg.find("span", class_="tgme_widget_message_views")
        views = views_elem.get_text() if views_elem else "N/A"
        
        # Text
        text_div = msg.find("div", class_="tgme_widget_message_text")
        text_md = clean_html_to_markdown(text_div) if text_div else ""
        
        # Media - Images
        images = []
        photo_elems = msg.find_all("a", class_="tgme_widget_message_photo_wrap")
        for ph in photo_elems:
            # Check inline style background-image
            style = ph.get("style", "")
            match = re.search(r"background-image:\s*url\(['\"]?(.*?)['\"]?\)", style)
            if match:
                images.append(match.group(1))
                
        parsed_messages.append({
            "post_id": post_id,
            "url": post_url,
            "date": date_str,
            "views": views,
            "text": text_md.strip(),
            "images": images
        })
        
    # Slice the latest posts
    parsed_messages = parsed_messages[-limit:]
    parsed_messages.reverse() # Show latest first
    
    return {
        "title": title,
        "description": description,
        "posts": parsed_messages
    }

if __name__ == "__main__":
    channel = sys.argv[1] if len(sys.argv) > 1 else "true_dyadya_d"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    res = parse_telegram_channel(channel, limit)
    print(json.dumps(res, ensure_ascii=False, indent=2))
