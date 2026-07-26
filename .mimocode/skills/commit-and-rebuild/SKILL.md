---
name: commit-and-rebuild
description: After every code fix, commit the changes and rebuild the Docker container. Used when the user says "fix this" or a bug is resolved. Never skip the rebuild step — from memory, the user insists on it.
---

# Commit and Rebuild Workflow

After every fix, follow this sequence. The user explicitly requires it: "Always commit and rebuild after fix. Git can be rolled back if needed."

## Steps

### 1. Verify the fix

Run the relevant test(s) first:

```
cd /root/smm && npx vitest run <path/to/test>
```

If the fix is frontend-only, verify the build compiles:

```
cd /root/smm && npm run build 2>&1 | tail -3
```

Note: 12 tests fail on prod because `/root/smm/.env` is intentionally absent. That's
background noise, not a regression — see `docs/DEPLOYMENT.md`.

### 2. Check git status

```
cd /root/smm && git status --short
```

### 3. Stage and commit

```
cd /root/smm && git add -A && git commit -m "fix: <one-line description of what was fixed>"
```

Follow the project's commit style: `fix:`, `feat:`, `refactor:`, `chore:` prefixes.

### 4. Pull before push

```
cd /root/smm && git pull --rebase
```

Other developers may be working on the same branch.

### 5. Push

```
cd /root/smm && git push
```

### 6. Rebuild Docker container

The prod compose file lives at `/root/docker-compose.yml`, **outside** the repo. Always pass
`-f` and always name the `smm` service — see `docs/DEPLOYMENT.md` for the full picture.

Standard rebuild (code-only changes):

```
docker compose -f /root/docker-compose.yml build smm && docker compose -f /root/docker-compose.yml up -d smm
```

No-cache rebuild (new exports/imports, changed `package.json`):

```
docker compose -f /root/docker-compose.yml build --no-cache smm && docker compose -f /root/docker-compose.yml up -d smm
```

Do **not** run `docker compose ... down` or `docker system prune` as part of a deploy —
the file holds the whole host stack (traefik, postgres, directus, n8n, video-app).

### 7. Verify deployment

```
docker ps --format "table {{.Names}}\t{{.Status}}" | grep smm
```

```
curl -s -o /dev/null -w "%{http_code}\n" https://smm.omemo.tech/health
```

Optionally verify the compiled bundle contains the fix:
```
docker exec smm grep -c "YOUR_FIX_PATTERN" /app/dist/server/index.js
```

## When to use

- After every bug fix
- After every feature implementation
- When the user says "commит" or "закоммить"
- Never skip the rebuild — the user will notice and ask

## Notes

- The user says: "Да, закоммить и пересобери обязательно. После любого фикса. Гит же можно откатить в случае чего."
- Container name: `smm` (not `root-smm-1`), image `root-smm`, compose project `root`
- Browser cache is never the issue — user always does Ctrl+Shift+R
- There are no `smm-rebuild` / `smm-test` host commands. Earlier revisions of this skill
  referenced them; the working equivalents are the commands above.