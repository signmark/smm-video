---
name: commit-and-rebuild
description: After every code fix, commit the changes and rebuild the Docker container. Used when the user says "fix this" or a bug is resolved. Never skip the rebuild step — from memory, the user insists on it.
---

# Commit and Rebuild Workflow

After every fix, follow this sequence. The user explicitly requires it: "Always commit and rebuild after fix. Git can be rolled back if needed."

## Steps

### 1. Verify the fix

- Run the relevant test(s) first: `smm-test` command.
- If the fix is frontend-only, verify the build compiles: `cd /root/smm && npm run build 2>&1 | tail -3`.

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

Use the `smm-rebuild` command. Choose the right variant:
- **Standard rebuild** for code-only changes (no new exports)
- **No-cache rebuild** if you added new exports, imports, or changed package.json

### 7. Verify deployment

```
docker ps --format "table {{.Names}}\t{{.Status}}" | grep smm
```

Optionally verify the compiled bundle contains the fix:
```
docker exec smm grep -c "YOUR_FIX_PATTERN" /app/dist/server/index.mjs
```

## When to use

- After every bug fix
- After every feature implementation
- When the user says "commит" or "закоммить"
- Never skip the rebuild — the user will notice and ask

## Notes

- The user says: "Да, закоммить и пересобери обязательно. После любого фикса. Гит же можно откатить в случае чего."
- Container name: `smm` (not `root-smm-1`)
- Browser cache is never the issue — user always does Ctrl+Shift+R