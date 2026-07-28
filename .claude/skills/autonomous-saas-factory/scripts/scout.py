import urllib.request
import json
import xml.etree.ElementTree as ET
import sys
from datetime import datetime
import os

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def fetch_json(url, timeout=10):
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        log(f"⚠️ Ошибка запроса JSON к {url}: {e}")
        return None

def fetch_xml(url, timeout=10):
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except Exception as e:
        log(f"⚠️ Ошибка запроса XML к {url}: {e}")
        return None

def get_hacker_news(limit=10):
    log("🔥 Получение трендов с HackerNews...")
    top_ids = fetch_json("https://hacker-news.firebaseio.com/v0/topstories.json")
    if not top_ids:
        return []
    
    results = []
    for story_id in top_ids[:limit]:
        detail = fetch_json(f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json")
        if detail and detail.get('type') == 'story':
            results.append({
                'title': detail.get('title'),
                'url': detail.get('url', f"https://news.ycombinator.com/item?id={story_id}"),
                'score': detail.get('score', 0),
                'comments': detail.get('descendants', 0)
            })
    return results

def get_vc_ru_popular(limit=10):
    log("🇷🇺 Получение популярных постов с VC.ru...")
    xml_data = fetch_xml("https://vc.ru/rss")
    if not xml_data:
        return []
    
    try:
        root = ET.fromstring(xml_data)
        items = []
        for item in root.findall('.//item')[:limit]:
            title = item.find('title')
            link = item.find('link')
            description = item.find('description')
            
            title_text = title.text if title is not None else "Без названия"
            link_text = link.text if link is not None else ""
            desc_text = description.text if description is not None else ""
            
            # Чистим описание от HTML тегов для превью
            if desc_text:
                import re
                desc_text = re.sub('<[^<]+?>', '', desc_text)[:150].strip() + "..."
                
            items.append({
                'title': title_text,
                'url': link_text,
                'description': desc_text
            })
        return items
    except Exception as e:
        log(f"⚠️ Ошибка парсинга RSS VC.ru: {e}")
        return []

def get_google_trends(geo='US', limit=10):
    log(f"📈 Получение трендов Google Trends ({geo})...")
    url = f"https://trends.google.com/trending/rss?geo={geo}"
    xml_data = fetch_xml(url)
    if not xml_data:
        return []
    
    try:
        root = ET.fromstring(xml_data)
        items = []
        for item in root.findall('.//item')[:limit]:
            title = item.find('title')
            approx_traffic = item.find('{htr://trends.google.com/trends/trendingsearches/daily}approx_traffic')
            
            title_text = title.text if title is not None else "Без названия"
            traffic_text = approx_traffic.text if approx_traffic is not None else "N/A"
            
            # Собираем ссылки на новости по теме
            news_items = []
            for news in item.findall('{htr://trends.google.com/trends/trendingsearches/daily}news_item')[:2]:
                news_title = news.find('{htr://trends.google.com/trends/trendingsearches/daily}news_item_title')
                news_url = news.find('{htr://trends.google.com/trends/trendingsearches/daily}news_item_url')
                if news_title is not None and news_url is not None:
                    news_items.append({'title': news_title.text, 'url': news_url.text})

            items.append({
                'title': title_text,
                'traffic': traffic_text,
                'news': news_items
            })
        return items
    except Exception as e:
        log(f"⚠️ Ошибка парсинга RSS Google Trends: {e}")
        return []

def generate_report():
    log("📊 Запуск сканирования трендов для снайперских SaaS...")
    
    hn_trends = get_hacker_news(10)
    vc_trends = get_vc_ru_popular(10)
    google_trends_us = get_google_trends('US', 10)
    google_trends_ru = get_google_trends('RU', 10)
    
    report_path = "scout_trends_report.md"
    
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# 🎯 Снайперский SaaS-Скаут: Отчёт по трендам от {datetime.now().strftime('%d.%m.%Y %H:%M')}\n\n")
        f.write("Этот отчёт сгенерирован автоматически для поиска микро-ниш, болей пользователей и зарождающихся трендов.\n\n")
        
        f.write("## 1. 🔥 HackerNews (Мировые технологические тренды и инди-хакинг)\n")
        f.write("Здесь ищем: новые опенсорс-инструменты, обсуждения болей разработчиков, запуски на Show HN.\n\n")
        if hn_trends:
            for idx, item in enumerate(hn_trends, 1):
                f.write(f"{idx}. **[{item['title']}]({item['url']})**\n")
                f.write(f"   *Рейтинг: {item['score']} | Комментариев: {item['comments']}*\n\n")
        else:
            f.write("*Не удалось собрать данные.*\n\n")
            
        f.write("## 2. 🇷🇺 VC.ru (Популярное в РФ: бизнес, маркетинг, стартапы)\n")
        f.write("Здесь ищем: локальные боли бизнеса, законы, проблемы с оплатами, успешные кейсы.\n\n")
        if vc_trends:
            for idx, item in enumerate(vc_trends, 1):
                f.write(f"{idx}. **[{item['title']}]({item['url']})**\n")
                if item['description']:
                    f.write(f"   *{item['description']}*\n\n")
        else:
            f.write("*Не удалось собрать данные.*\n\n")
            
        f.write("## 3. 📈 Google Trends US (Массовый спрос в США)\n")
        if google_trends_us:
            for idx, item in enumerate(google_trends_us, 1):
                f.write(f"{idx}. **{item['title']}** (Трафик: {item['traffic']}+)\n")
                for news in item['news']:
                    f.write(f"   - [{news['title']}]({news['url']})\n")
                f.write("\n")
        else:
            f.write("*Не удалось собрать данные.*\n\n")

        f.write("## 4. 📈 Google Trends RU (Массовый спрос в РФ)\n")
        if google_trends_ru:
            for idx, item in enumerate(google_trends_ru, 1):
                f.write(f"{idx}. **{item['title']}** (Трафик: {item['traffic']}+)\n")
                for news in item['news']:
                    f.write(f"   - [{news['title']}]({news['url']})\n")
                f.write("\n")
        else:
            f.write("*Не удалось собрать данные.*\n\n")

    log(f"🎉 Отчёт успешно сгенерирован и сохранён в файл: {report_path}")

if __name__ == "__main__":
    generate_report()
