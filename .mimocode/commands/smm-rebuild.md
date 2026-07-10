---
name: smm-rebuild
description: Rebuild and restart the SMM Docker container. Use --no-cache for full rebuild (new exports, package changes) or omit for incremental build (code-only changes).
---

# Rebuild SMM container

Rebuilds the `smm` service from docker-compose and restarts it.

**ВАЖНО:** `docker-compose.yml` лежит в `/root/` (родительская директория проекта). ВСЕГДА используй полный путь `-f /root/docker-compose.yml`.

## Usage

**Standard rebuild (cached):** fastest for code-only changes.

```
docker compose -f /root/docker-compose.yml up -d --build smm 2>&1 | tail -5
```

**Full rebuild (no cache):** required when adding new exports, imports, or package dependencies — esbuild caches module resolution.

```
docker compose -f /root/docker-compose.yml build --no-cache smm 2>&1 | tail -5 && docker compose -f /root/docker-compose.yml up -d smm 2>&1 | tail -3
```

**Fast frontend-only deploy:** for quick CSS/JS iteration without full Docker build.

```
cd /root/smm && npm run build 2>&1 | tail -2 && docker cp ./dist smm:/app/ && docker restart smm
```

## When to use each

| Situation | Command |
|---|---|
| Quick code fix, no new exports | Standard rebuild |
| New exports, imports, or package changes | Full no-cache rebuild |
| Frontend-only CSS/JS changes | Fast frontend deploy |

## Notes

- Container name is `smm` (not `root-smm-1`).
- `docker cp` ИНОГДА не работает — файлы в контейнере owned by `node:node`, `docker cp` пишет как `root` → permission denied. Если `docker cp` упал с ошибкой — используй `docker compose build`.
- После деплоя проверяй: `docker ps --format "table {{.Names}}\t{{.Status}}" | grep smm`.
- **Для мелких правок (фронтенд/CSS/JS)** — достаточно быстрого деплоя через `docker cp`. Для бэкенда или если `docker cp` не работает — полный rebuild.