import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Import the parser function from read_tg_channel
sys.path.append("/root/hermes-bot")
try:
    from read_tg_channel import parse_telegram_channel
except ImportError:
    try:
        sys.path.append("/home/signmark")
        from read_tg_channel import parse_telegram_channel
    except ImportError:
        def parse_telegram_channel(channel_username, limit=3):
            return {"error": "Import failed"}

STATE_FILE = "/root/hermes-bot/scout_state.json"
if not os.path.exists(STATE_FILE):
    STATE_FILE = "/home/signmark/scout_state.json"

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving state: {e}", file=sys.stderr)

def load_channels():
    paths = [
        "/root/hermes-bot/empire_channels.txt",
        "/home/signmark/empire_channels.txt"
    ]
    for path in paths:
        if os.path.exists(path):
            channels = []
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    username = line.split()[0].replace("@", "")
                    channels.append(username)
            return channels
    return []

def fetch_channel_data(channel, limit):
    return channel, parse_telegram_channel(channel, limit=limit)

def generate_digest(limit_per_channel=5, check_state=True):
    channels = load_channels()
    if not channels:
        return "⚠️ Список каналов в empire_channels.txt пуст или файл не найден."
        
    state = load_state() if check_state else {}
    new_state = dict(state)
    
    digest_lines = []
    has_any_new = False
    
    # Fetch in parallel (max 15 concurrent threads to avoid rate limits)
    fetched_data = {}
    with ThreadPoolExecutor(max_workers=15) as executor:
        futures = {executor.submit(fetch_channel_data, ch, limit_per_channel): ch for ch in channels}
        for future in as_completed(futures):
            ch, data = future.result()
            fetched_data[ch] = data

    # Process sequentially to keep file order
    for channel in channels:
        data = fetched_data.get(channel)
        if not data or "error" in data:
            continue
            
        title = data.get("title", channel)
        desc = data.get("description", "")
        posts = data.get("posts", [])
        
        last_seen_id = state.get(channel, 0)
        
        # Filter posts to only show ones newer than last_seen_id
        new_posts = []
        for post in posts:
            try:
                pid = int(post.get("post_id", 0))
            except ValueError:
                pid = 0
            if pid > last_seen_id:
                new_posts.append(post)
                
        # If we have posts, the maximum ID among them will be the new last_seen_id
        all_pids = [int(p.get("post_id", 0)) for p in posts if p.get("post_id", "").isdigit()]
        if all_pids:
            new_state[channel] = max(all_pids)
            
        if not new_posts:
            continue
            
        has_any_new = True
        digest_lines.append(f"## 📢 [{title}](https://t.me/s/{channel}) (@{channel})")
        if desc:
            clean_desc = desc.replace("\n", " ")
            if len(clean_desc) > 100:
                clean_desc = clean_desc[:100] + "..."
            digest_lines.append(f"*{clean_desc}*")
        digest_lines.append("")
        
        # Display the new posts
        for post in new_posts:
            post_id = post.get("post_id")
            views = post.get("views", "0")
            text = post.get("text", "")
            date_raw = post.get("date")
            
            date_formatted = ""
            if date_raw:
                try:
                    dt = datetime.fromisoformat(date_raw)
                    date_formatted = dt.strftime("%d.%m %H:%M")
                except:
                    date_formatted = date_raw
                    
            header = f"🔹 **Пост #{post_id}**"
            meta = []
            if date_formatted:
                meta.append(f"📅 {date_formatted}")
            if views:
                meta.append(f"👁️ {views}")
            if meta:
                header += f" ({', '.join(meta)})"
                
            digest_lines.append(header)
            
            if text:
                quoted_text = "\n".join([f"> {line}" for line in text.split("\n")])
                digest_lines.append(quoted_text)
            else:
                digest_lines.append("> *Безтекстовый пост (медиа или репост)*")
                
            images = post.get("images", [])
            if images:
                digest_lines.append(f"> _Изображений: {len(images)}_")
                
            digest_lines.append("") # Spacer
            
        digest_lines.append("---")
        
    if not has_any_new:
        return ""
        
    if check_state:
        save_state(new_state)
        
    # Put title on top
    header = f"# 🏰 Сводка Империи ИИ-Скаута | {datetime.now().strftime('%d.%m.%Y %H:%M')}\n\n"
    return header + "\n".join(digest_lines)

if __name__ == "__main__":
    # If "--all" argument is passed, ignore state and show all latest posts
    all_posts = "--all" in sys.argv
    limit = 5
    for arg in sys.argv[1:]:
        if arg.isdigit():
            limit = int(arg)
            break
            
    res = generate_digest(limit_per_channel=limit, check_state=not all_posts)
    print(res)
