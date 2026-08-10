import os
import asyncio
import logging
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
import psycopg2
import docker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('hermes-dashboard')

app = FastAPI(
    title='Hermes Dashboard',
    docs_url='/dashboard/docs',
    openapi_url='/dashboard/openapi.json'
)

# Docker Client
try:
    docker_client = docker.DockerClient(base_url='unix://var/run/docker.sock')
except Exception as e:
    logger.error(f'Failed to connect to docker socket: {e}')
    docker_client = None

# DB connection config
DB_HOST = os.getenv('DB_HOST', 'postgres')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'directus')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('POSTGRES_PASSWORD', '')

def get_db_stats():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            connect_timeout=3
        )
        cur = conn.cursor()
        
        # 1. Counts of statuses
        cur.execute('SELECT qualification_status, COUNT(*) FROM leads_qualification GROUP BY qualification_status;')
        rows = cur.fetchall()
        stats = {}
        for row in rows:
            status_val = row[0]
            count_val = row[1]
            status_key = status_val.lower() if status_val is not None else 'pending'
            stats[status_key] = stats.get(status_key, 0) + count_val
        for status in ['hot', 'warm', 'cold', 'trash', 'pending']:
            if status not in stats:
                stats[status] = 0
                
        # 2. Top products/topics for Hot and Warm (excluding 'Не определено')
        cur.execute("""
            SELECT target_product, COUNT(*) 
            FROM leads_qualification 
            WHERE qualification_status IN ('hot', 'warm') 
              AND target_product IS NOT NULL 
              AND target_product != 'Не определено'
            GROUP BY target_product 
            ORDER BY COUNT(*) DESC 
            LIMIT 5;
        """)
        top_rows = cur.fetchall()
        top_topics = [{"topic": row[0], "count": row[1]} for row in top_rows]
        
        cur.close()
        conn.close()
        return {'counts': stats, 'top_topics': top_topics}
    except Exception as e:
        logger.error(f'DB Error: {e}')
        return {
            'counts': {'hot': 0, 'warm': 0, 'cold': 0, 'trash': 0, 'pending': 0},
            'top_topics': [],
            'error': str(e)
        }

@app.get('/dashboard', response_class=HTMLResponse)
@app.get('/dashboard/', response_class=HTMLResponse)
async def serve_dashboard(request: Request):
    try:
        with open('templates/index.html', 'r', encoding='utf-8') as f:
            html_content = f.read()
        return HTMLResponse(content=html_content)
    except Exception as e:
        return HTMLResponse(content=f'<h1>Dashboard Error</h1><p>{e}</p>', status_code=500)

@app.get('/dashboard/api/stats')
async def api_stats():
    containers = []
    if docker_client:
        try:
            for c in docker_client.containers.list(all=True):
                containers.append({
                    'name': c.name,
                    'status': c.status,
                    'image': c.image.tags[0] if c.image.tags else 'unknown'
                })
        except Exception as e:
            logger.error(f'Error fetching containers: {e}')
    
    db_data = get_db_stats()
    
    # Base server load metrics
    sys_info = {'cpu': 0, 'memory': 0}
    try:
        with open('/proc/loadavg', 'r') as f:
            sys_info['cpu'] = float(f.read().split()[0])
        with open('/proc/meminfo', 'r') as f:
            lines = f.readlines()
            mem_total = 1
            mem_free = 0
            for line in lines:
                if 'MemTotal' in line:
                    mem_total = int(line.split()[1])
                elif 'MemAvailable' in line or 'MemFree' in line:
                    mem_free = int(line.split()[1])
            sys_info['memory'] = round((1 - mem_free/mem_total) * 100, 1)
    except:
        pass
        
    return {
        'containers': containers,
        'db_stats': db_data['counts'],
        'top_topics': db_data['top_topics'],
        'sys_info': sys_info
    }

@app.post('/dashboard/api/containers/{name}/{action}')
async def container_action(name: str, action: str):
    if not docker_client:
        return {'success': False, 'error': 'Docker client offline'}
    try:
        c = docker_client.containers.get(name)
        if action == 'start':
            c.start()
        elif action == 'stop':
            c.stop()
        elif action == 'restart':
            c.restart()
        else:
            return {'success': False, 'error': f'Unknown action {action}'}
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}

@app.get('/dashboard/api/logs/{name}')
async def stream_logs(name: str):
    if not docker_client:
        return StreamingResponse(iter(['data: Docker client offline\n\n']), media_type='text/event-stream')
    try:
        container = docker_client.containers.get(name)
        
        async def log_generator():
            try:
                logs = container.logs(tail=50, stdout=True, stderr=True, follow=False)
                for line in logs.decode('utf-8', errors='ignore').split('\n'):
                    if line:
                        yield f'data: {line}\n\n'
            except Exception as e:
                logger.error(f'Error reading initial logs: {e}')
                
            try:
                stream = container.logs(stdout=True, stderr=True, stream=True, follow=True)
                for line in stream:
                    yield f'data: {line.decode("utf-8", errors="ignore")}\n\n'
                    await asyncio.sleep(0.05)
            except Exception as e:
                yield f'data: [Stream closed: {e}]\n\n'
                
        headers = {
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }
        return StreamingResponse(log_generator(), media_type='text/event-stream', headers=headers)
    except Exception as e:
        return StreamingResponse(iter([f'data: Error: {e}\n\n']), media_type='text/event-stream')
