import os
import uuid
import shutil
import urllib.request
import xml.etree.ElementTree as ET
import subprocess
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="SilentSentry API", version="1.0.0")

# Enable CORS for the frontend to talk to it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "/tmp/silentsentry_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ENGINE_PATH = "/app/silentsentry.py"

class RSSRequest(BaseModel):
    feed_url: str
    episode_index: int = 0

def get_episode_from_rss(feed_url: str, index: int = 0):
    """Parses RSS feed and extracts targeted episode title and media URL."""
    try:
        req = urllib.request.Request(
            feed_url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        items = root.findall('.//item')
        if not items:
            return None
            
        if index >= len(items):
            index = 0
        target_item = items[index]
        
        title_el = target_item.find('title')
        title = title_el.text if title_el is not None else "Untitled Episode"
        
        enclosure = target_item.find('enclosure')
        if enclosure is None:
            # Check for media:content or similar as fallback
            return None
            
        audio_url = enclosure.get('url')
        return {
            "title": title,
            "audio_url": audio_url
        }
    except Exception as e:
        raise Exception(f"RSS Parsing Error: {str(e)}")

@app.post("/api/scan")
async def api_scan(file: UploadFile = File(...)):
    """Scans uploaded audio for ultrasonic beacons."""
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] or ".mp3"
    input_path = os.path.join(UPLOAD_DIR, f"{file_id}_input{ext}")
    
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    cmd = ["python3", ENGINE_PATH, "scan", input_path]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    # Cleanup input
    if os.path.exists(input_path):
        os.remove(input_path)
        
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr or "Scan failed")
        
    try:
        import json
        return json.loads(result.stdout)
    except Exception:
        return {"output": result.stdout}

@app.post("/api/clean")
async def api_clean(file: UploadFile = File(...)):
    """Sanitizes uploaded audio and returns the clean file directly."""
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] or ".mp3"
    input_path = os.path.join(UPLOAD_DIR, f"{file_id}_input{ext}")
    output_path = os.path.join(UPLOAD_DIR, f"{file_id}_clean{ext}")
    
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    cmd = ["python3", ENGINE_PATH, "clean", input_path, output_path]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    # Cleanup input
    if os.path.exists(input_path):
        os.remove(input_path)
        
    if result.returncode != 0:
        if os.path.exists(output_path):
            os.remove(output_path)
        raise HTTPException(status_code=500, detail=result.stderr or "Sanitization failed")
        
    return FileResponse(
        output_path, 
        media_type="audio/mpeg", 
        filename=f"sanitized_{file.filename}"
    )

@app.post("/api/full")
async def api_full(file: UploadFile = File(...)):
    """Runs a full scan-clean-scan cycle and returns the report and file ID."""
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] or ".mp3"
    input_path = os.path.join(UPLOAD_DIR, f"{file_id}_input{ext}")
    output_path = os.path.join(UPLOAD_DIR, f"{file_id}_clean{ext}")
    
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    cmd = ["python3", ENGINE_PATH, "full", input_path, output_path]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    # Cleanup input
    if os.path.exists(input_path):
        os.remove(input_path)
        
    if result.returncode != 0:
        if os.path.exists(output_path):
            os.remove(output_path)
        raise HTTPException(status_code=500, detail=result.stderr or "Process failed")
        
    try:
        import json
        report = json.loads(result.stdout)
        report["download_url"] = f"/api/download/{file_id}{ext}"
        return report
    except Exception as e:
        return {"error": "Failed to parse report", "output": result.stdout}

@app.post("/api/rss")
async def api_rss(req: RSSRequest):
    """Parses RSS, downloads targeted episode, sanitizes it, and returns report."""
    try:
        # 1. Parse RSS Feed
        ep_info = get_episode_from_rss(req.feed_url, req.episode_index)
        if not ep_info:
            raise HTTPException(status_code=400, detail="No valid episodes found with audio files in RSS feed.")
            
        file_id = str(uuid.uuid4())
        ext = ".mp3" # Default
        
        input_path = os.path.join(UPLOAD_DIR, f"{file_id}_input{ext}")
        output_path = os.path.join(UPLOAD_DIR, f"{file_id}_clean{ext}")
        
        # 2. Download enclosure audio file
        download_req = urllib.request.Request(
            ep_info["audio_url"], 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(download_req, timeout=30) as response, open(input_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
            
        # 3. Process via SilentSentry Engine
        cmd = ["python3", ENGINE_PATH, "full", input_path, output_path]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        # Cleanup input
        if os.path.exists(input_path):
            os.remove(input_path)
            
        if result.returncode != 0:
            if os.path.exists(output_path):
                os.remove(output_path)
            raise HTTPException(status_code=500, detail=result.stderr or "Sanitization process failed")
            
        import json
        report = json.loads(result.stdout)
        report["title"] = ep_info["title"]
        report["download_url"] = f"/api/download/{file_id}{ext}"
        return report
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/download/{file_id}")
async def api_download(file_id: str):
    """Serves the sanitized file for download."""
    # Find the clean file in upload dir matching file_id
    for f in os.listdir(UPLOAD_DIR):
        if f.startswith(file_id) and ("_clean" in f):
            file_path = os.path.join(UPLOAD_DIR, f)
            return FileResponse(
                file_path, 
                media_type="audio/mpeg", 
                filename=f"sanitized_podcast.mp3"
            )
    raise HTTPException(status_code=404, detail="File not found or expired")

@app.get("/health")
def health():
    return {"status": "ok", "service": "SilentSentry API"}
