# AI Provider Model Name Mismatch Debugging

## Symptom

AI API calls hang/Timeout (ReadTimeout or Connection error). No visible error in frontend Network tab — the request leaves the browser (200s from Vercel proxy) but the backend logs show:

```
services.aihub - ERROR - gentxt error: Connection error.
routers.aihub - ERROR - Text generation failed: Connection error.
```

Or the docker logs show `ReadTimeout` after ~15 seconds with no response body.

## Root Cause

The model name passed to the OpenAI-compatible API provider doesn't exist or isn't recognized. The provider hangs instead of returning a 404.

**Unlike OpenAI's native API (which returns immediate 404 for unknown models), proxy/aggregator services (omni.zhdanov.pw style) may silently timeout.**

## Diagnosis

### 1. List available models on the provider

```bash
# From the backend container or server
curl -s https://your-ai-provider.domain/v1/models | python3 -c "import json,sys; [print(m['id']) for m in json.load(sys.stdin).get('data',[])]"
```

### 2. Compare with hardcoded model names in frontend

```bash
# Search frontend source for hardcoded model names
grep -r "model:\s*'" src/pages/ | grep -v node_modules
```

### 3. Check backend .env default model

```bash
grep APP_AI_MODEL .env
```

### 4. Test the model directly against the provider

```python
import asyncio, httpx

async def test_model(model_name: str):
    """Test if a model works. Timeout = wrong name."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            "https://provider.domain/v1/chat/completions",
            json={
                "model": model_name,
                "messages": [{"role": "user", "content": "Say hi"}],
                "max_tokens": 20,
                "stream": False
            },
            headers={"Authorization": f"Bearer {API_KEY}"}
        )
        print(f"{model_name} -> {r.status_code}")
        if r.status_code == 200:
            print(r.json()['choices'][0]['message']['content'])

# Test all candidates:
for m in ["kr/claude-sonnet-4.5", "claude/claude-sonnet-4-6", "cc/claude-sonnet-4-6"]:
    await test_model(m)
```

## Fix: Full-Stack Model Name Update

Model names often appear in **both** frontend and backend — fix both layers:

### Frontend: Search all hardcoded references

```bash
grep -rn "old-model-name" src/  # Find all locations
```

Common locations: Coach.tsx, Today.tsx, Progress.tsx, any AI-related page.

### Backend: Update .env

```bash
sed -i 's|APP_AI_MODEL=old/name|APP_AI_MODEL=new/name|' .env
docker compose restart  # if using Docker
```

### Frontend: Update all occurrences and redeploy

```bash
# After replacing model name in source files:
cd frontend && vercel deploy --prod
```

## Prevention

- When switching AI providers, always list available models first and pick one that exists
- Never hardcode model names in N places — move to a shared config constant
- On the backend, add a model validation check at startup: query the provider's `/v1/models` and log a warning if the configured model isn't found
- For external providers (omni, openrouter, etc.), model names may use vendor prefixes (`claude/`, `cc/`, `kr/`, `cx/`) — verify the prefix matches the provider's routing scheme

## Gotchas

- `ReadTimeout` vs `Connection error`: both can mean wrong model name; `Connection error` may also mean the provider is unreachable (DNS, network)
- Same host AI provider (Docker → host's own domain): works with urllib but httpx through the openai SDK can fail due to proxy settings or DNS resolution differences inside the container
- Differing model name conventions across providers: `cc/claude-sonnet-4-6` vs `claude/claude-sonnet-4-6` vs `anthropic/claude-sonnet-4-6` — prefixes matter
- Vite builds bake VITE_* env vars at build time — model names hardcoded in source files require a NEW deploy
