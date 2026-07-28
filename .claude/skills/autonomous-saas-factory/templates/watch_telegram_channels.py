#!/usr/bin/env python3
import urllib.request
import re
import os
import html

SCOUTING_FILE = "/opt/data/hermes-vault/scouting_network.md"
STATE_DIR = "/opt/data/.hermes/scripts"

# Default hardcoded competitors if they are not in scouting_network.md
DEFAULT_MONITOR = {
    "romarayt": "Рома Райт",
    "Neyro_MBA": "Нейро-МВА",
    "ai_comandos": "Дмитрий Попов | AI Командос",
    "mspiridonov": "Максим Спиридонов",
    "vibecodings": "Vibecoder | Станислав Быстрицкий",
    "yefimov_ai": "Yefimov AI 🚀"
}

def clean_html(text):
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return text.strip()

def get_latest_post(channel):
    url = f"https://t.me/s/{channel}"
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'}
    )
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
    
    # Extract public message texts
    matches = re.findall(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', content, re.DOTALL)
    if not matches:
        return None
    
    # Get the latest post
    latest_raw = matches[-1]
    return clean_html(latest_raw)

def load_channels_from_scouting():
    channels = {}
    if not os.path.exists(SCOUTING_FILE):
        return channels
        
    with open(SCOUTING_FILE, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Table rows: | 1 | `@true_dyadya_d` | ... | Description | ... | 🟢 Активен |
    # Regex to capture `@username` and the description/display name
    rows = re.findall(r'\|\s*\d+\s*\|\s*`@([^`]+)`\s*\|\s*\[Ссылка\]\([^)]+\)\s*\|\s*([^|]+)\s*\|.*?🟢\s*Активен', content)
    for username, desc in rows:
        username = username.strip()
        desc = desc.strip()
        # Clean description to be a short name (split by dash or keep first 30 chars)
        short_name = desc.split(" - ")[0].split(" – ")[0].split(" | ")[0].strip()
        channels[username] = short_name
        
    return channels

def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    
    # Load from file
    scouted_channels = load_channels_from_scouting()
    
    # Merge with default competitors
    monitored_channels = {**DEFAULT_MONITOR, **scouted_channels}
    
    print(f"Loaded {len(monitored_channels)} channels in total (from scouting_network.md + custom watchlist).")
    
    updates_found = []
    
    for channel, display_name in monitored_channels.items():
        state_file = os.path.join(STATE_DIR, f"last_seen_{channel}.txt")
        try:
            latest = get_latest_post(channel)
            if not latest:
                continue
            
            # Read last seen post
            last_seen = ""
            if os.path.exists(state_file):
                with open(state_file, "r", encoding="utf-8") as f:
                    last_seen = f.read().strip()
            
            # If new post found
            if latest != last_seen:
                # Write new state
                with open(state_file, "w", encoding="utf-8") as f:
                    f.write(latest)
                
                # Format update
                updates_found.append(
                    f"🔔 **Новый пост на канале [{display_name}](https://t.me/{channel}) (@{channel}):**\n\n"
                    f"{latest}\n\n"
                    f"---"
                )
        except Exception as e:
            pass
            
    if updates_found:
        print("\n\n========================================\n\n".join(updates_found))
    else:
        print("No new posts found on monitored channels.")

if __name__ == "__main__":
    main()
