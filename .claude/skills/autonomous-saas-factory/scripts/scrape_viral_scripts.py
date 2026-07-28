#!/usr/bin/env python3
"""
Viral Shorts/Reels Script Extractor v3
Для конвейера SMM Manager (Pillar 5 — Auto-Marketing).
Ищет вирусные Shorts/Reels на YouTube и Instagram, вытаскивает сценарии.

YouTube: youtube-transcript-api (без авторизации)
Instagram: instaloader (анонимно)

Usage:
  python3 scrape_viral_scripts.py "бизнес идеи" --youtube 5
  python3 scrape_viral_scripts.py --urls https://youtube.com/watch?v=XXXX

Output: smm-video/data/viral_*.json
"""

import sys, os, json, re, argparse, urllib.request, urllib.parse, html
from datetime import datetime

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/120.0.0.0 Safari/537.36")

SMM_VIDEO_DIR = "/home/signmark/Development/smm-video"


# ─── YouTube: поиск ─────────────────────────────────────────────────────

def search_youtube_ids(query: str, max_results: int = 10) -> list:
    """Ищет видео через парсинг HTML. Возвращает list video_id."""
    ids, seen = [], set()
    params = urllib.parse.urlencode({"search_query": f"{query} shorts"})
    try:
        req = urllib.request.Request(
            f"https://www.youtube.com/results?{params}",
            headers={"User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html_content = resp.read().decode("utf-8", errors="replace")
        found = re.findall(r'videoId["\']?\s*[:=]\s*["\']([a-zA-Z0-9_-]{11})["\']', html_content)
        for vid in found:
            if vid not in seen:
                seen.add(vid)
                ids.append(vid)
                if len(ids) >= max_results:
                    break
    except Exception:
        pass
    return ids


# ─── YouTube: транскрипты ───────────────────────────────────────────────

def get_transcript(video_id: str) -> str:
    """Транскрипт через youtube-transcript-api. Без авторизации."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript = YouTubeTranscriptApi().fetch(video_id, languages=["ru", "en"])
        text = " ".join(s.text for s in transcript)
        text = re.sub(r"\[.*?\]", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text
    except Exception:
        return ""


def get_video_metadata(video_id: str) -> dict:
    """Парсит страницу видео для метаданных (без yt-dlp)."""
    meta = {"title": "Unknown", "channel": "Unknown", "views": 0, "duration": 0}
    try:
        req = urllib.request.Request(
            f"https://www.youtube.com/watch?v={video_id}",
            headers={"User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            html_content = resp.read().decode("utf-8", errors="replace")
        m = re.search(r'<title>(.+?)</title>', html_content)
        if m:
            t = html.unescape(m.group(1))
            t = re.sub(r'\s*-\s*YouTube\s*$', '', t)
            meta["title"] = re.sub(r'\s*#shorts\s*', '', t, flags=re.IGNORECASE).strip()
        m = re.search(r'"ownerChannelName"\s*:\s*"([^"]+)"', html_content)
        if m:
            meta["channel"] = m.group(1)
        m = re.search(r'"viewCount"\s*:\s*"(\d+)"', html_content)
        if m:
            meta["views"] = int(m.group(1))
        m = re.search(r'"lengthSeconds"\s*:\s*"(\d+)"', html_content)
        if m:
            meta["duration"] = int(m.group(1))
    except Exception:
        pass
    return meta


def extract_youtube(query_or_urls, max_results: int = 10) -> list:
    """Универсальный экстрактор: строка запроса, URL, или список URL."""
    results, ids_to_process = [], []

    if isinstance(query_or_urls, str):
        m = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', query_or_urls)
        if not m:
            m = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', query_or_urls)
        if m:
            ids_to_process = [m.group(1)]
        else:
            ids_to_process = search_youtube_ids(query_or_urls, max_results)
    elif isinstance(query_or_urls, list):
        for url in query_or_urls:
            m = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', url)
            if not m:
                m = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', url)
            if m:
                ids_to_process.append(m.group(1))

    if not ids_to_process:
        return results

    for vid in ids_to_process:
        if len(results) >= max_results:
            break
        try:
            meta = get_video_metadata(vid)
            script = get_transcript(vid)
            if not script and meta["views"] < 1000:
                continue
            results.append({
                "platform": "youtube",
                "url": f"https://youtube.com/watch?v={vid}",
                "title": meta["title"],
                "channel": meta["channel"],
                "duration": meta["duration"],
                "stats": {"views": meta["views"], "likes": 0},
                "script": script,
            })
        except Exception:
            pass

    results.sort(key=lambda r: r["stats"]["views"], reverse=True)
    return results


# ─── Instagram ──────────────────────────────────────────────────────────

def extract_instagram(hashtag: str, max_results: int = 10) -> list:
    try:
        from instaloader import Instaloader, Hashtag
    except ImportError:
        return []
    loader = Instaloader(quiet=True, download_pictures=False,
                         download_videos=False, compress_json=False,
                         max_connection_attempts=2)
    tag = hashtag.lstrip("#")
    try:
        h = Hashtag.from_name(loader.context, tag)
    except Exception:
        return []
    results, count = [], 0
    try:
        for post in h.get_posts():
            if count >= max_results:
                break
            if not post.is_video:
                continue
            script = post.caption or ""
            script = re.sub(r"#\S+|@\S+|http\S+", "", script)
            script = re.sub(r"\s+", " ", script).strip()
            results.append({
                "platform": "instagram",
                "url": f"https://instagram.com/p/{post.shortcode}/",
                "title": script[:80] or "No caption",
                "channel": post.owner_username or "Unknown",
                "duration": getattr(post, 'video_duration', 0) or 0,
                "stats": {"views": post.video_view_count or 0,
                          "likes": post.likes or 0,
                          "comments": post.comments or 0},
                "script": script,
            })
            count += 1
    except Exception:
        pass
    results.sort(key=lambda r: r["stats"]["views"], reverse=True)
    return results


# ─── Save ───────────────────────────────────────────────────────────────

def save_results(all_results, query, output_path=""):
    if not output_path:
        safe = re.sub(r"[^a-zA-Z0-9а-яА-Я_]", "_", query)[:30]
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        output_path = f"{SMM_VIDEO_DIR}/data/viral_{safe}_{ts}.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({
            "query": query,
            "collected_at": datetime.now().isoformat(),
            "total": len(all_results),
            "scripts": all_results,
        }, f, ensure_ascii=False, indent=2)
    return output_path


# ─── Main ───────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Viral Shorts/Reels Script Extractor")
    ap.add_argument("query", nargs="?", default="", help="Поисковый запрос или URL")
    ap.add_argument("--youtube", "-yt", type=int, default=5)
    ap.add_argument("--instagram", "-ig", type=int, default=0)
    ap.add_argument("--output", "-o", default="")
    ap.add_argument("--min-script", type=int, default=20)
    ap.add_argument("--urls", nargs="+", default=[])
    args = ap.parse_args()

    all_results = []
    if args.urls:
        all_results.extend(extract_youtube(args.urls, len(args.urls)))
    elif args.query:
        all_results.extend(extract_youtube(args.query, args.youtube))
    if args.instagram > 0 and args.query:
        all_results.extend(extract_instagram(args.query, args.instagram))

    all_results = [r for r in all_results if len(r.get("script", "")) >= args.min_script]

    if not all_results:
        print("❌ Ничего не собрано. Используйте --urls для прямых ссылок.")
        return

    for i, r in enumerate(all_results, 1):
        preview = r["script"].replace("\n", " ")[:200]
        v = r["stats"]["views"]
        print(f"\n  #{i} | {r['platform'].upper()} | {v:,} views")
        print(f"  📹 {r['title'][:60]} | 👤 {r['channel']}")
        print(f"  📝 {preview}...")

    path = save_results(all_results, args.query or "direct_urls", args.output)
    print(f"\n💾 {path} ({sum(len(r['script']) for r in all_results):,} chars)")


if __name__ == "__main__":
    main()
