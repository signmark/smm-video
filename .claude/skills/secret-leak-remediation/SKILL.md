---
name: secret-leak-remediation
description: "Complete playbook for remediating leaked secrets in git repositories: key rotation, history rewriting with git-filter-repo, .gitignore hardening, force push, and verification."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [security, git, secrets, incident-response, git-filter-repo, github]
    category: devops
    related_skills: [github-repo-management, systematic-debugging]
---

# Secret Leak Remediation

When a secret scanner (GitGuardian, GitHub Secret Scanning, TruffleHog, etc.) detects leaked credentials in a Git repository, follow this exact sequence. **Time is critical** — every minute the key is valid is exposure.

## Trigger

- GitGuardian alert email / webhook
- GitHub "Secret scanning alert" notification
- CI/CD pipeline secret scan failure
- Manual discovery (`git log --all --oneline | xargs -I{} git show {} | grep -E "(api_key|secret|token)"`)

---

## Phase 1: Immediate Key Rotation (Do FIRST, before git cleanup)

| Provider | Action | URL |
|----------|--------|-----|
| **OpenRouter** | Delete compromised key → Create new | https://openrouter.ai/keys |
| **Anthropic** | Revoke → Generate new | https://console.anthropic.com/settings/keys |
| **OpenAI** | Revoke → Create new | https://platform.openai.com/api-keys |
| **HuggingFace** | Delete token → Create new | https://huggingface.co/settings/tokens |
| **Nous Portal** | Revoke → Generate new | https://portal.nousresearch.com/manage-subscription |
| **GitHub** (PAT) | Delete → Create new (min scopes) | https://github.com/settings/tokens |
| **Firecrawl / FAL / other** | Rotate in respective dashboards | — |
| **Telegram Bot Token** | Revoke via @BotFather `/revoke` → create a new bot → update env/config | https://t.me/BotFather |

> ⚠️ **Do not wait for git cleanup.** Rotate keys immediately. The old key is compromised the moment it hits a public/private repo that scanners can reach.

---

## Phase 2: Remove Secret from Git History

### Tool: `git-filter-repo` (not `git filter-branch`, not BFG)

```bash
# Install (one-time)
pip3 install --break-system-packages git-filter-repo

# Remove specific file from ALL history
cd /path/to/repo
git filter-repo --path config.yaml --invert-paths --force

# Or remove by pattern (e.g., all .env files)
git filter-repo --path-glob "*.env" --invert-paths --force

# Or remove specific commit (if you know the exact commit)
git filter-repo --commit-callback '
  if commit.original_id == b"739a7fae7709cd3d580fdaefdbecdbddcc2de001":
    commit.skip()
' --force
```

**Why git-filter-repo:**
- 10-100x faster than `filter-branch`
- Handles tags, branches, refs correctly
- Official replacement recommended by Git project
- Preserves commit hashes for untouched commits

### After filter-repo:

```bash
# Remote is removed - re-add
git remote add origin git@github.com:owner/repo.git
git fetch

# Verify secret is gone
git log --all --oneline --grep="secret"  # should be empty
git log --all --oneline -p | grep -i "api_key"  # should be empty
```

---

## Phase 3: Harden .gitignore

Add the leaked file/pattern to `.gitignore` **before** creating new commits:

```bash
echo "config.yaml" >> .gitignore
echo ".env" >> .gitignore
echo "*.env" >> .gitignore
echo "auth.json" >> .gitignore
# Add any other secret files
git add .gitignore
git commit -m "chore: add secret files to .gitignore"
```

> **Never commit the secret file again.** The `.gitignore` must be in place before any new commit that could touch those paths.

---

## Phase 4: Force Push Cleaned History

```bash
# DANGER: Rewrites remote history. Coordinate with team first.
git push origin master --force
# Or for all branches/tags:
git push origin --force --all
git push origin --force --tags
```

**Coordinate with team:**
- All collaborators must re-clone or `git fetch && git reset --hard origin/master`
- CI/CD pipelines may need re-trigger
- Protected branch rules may need temporary bypass

---

## Phase 5: Verification

### Local verification
```bash
# 1. Confirm file absent in history
git log --all --full-history -- config.yaml  # should show only the removal commit

# 2. Scan for any remaining secrets
git log --all --oneline -p | grep -E "(sk-|ghp_|gho_|github_pat_|api_key|secret|token)" | head -20

# 3. Use trufflehog (if installed)
trufflehog git file://. --since-commit HEAD~100
```

### Remote verification (GitHub)
```bash
# Check file doesn't exist on remote
gh api repos/owner/repo/contents/config.yaml
# Should return 404

# Trigger GitHub secret scanning re-scan
gh api -X POST repos/owner/repo/secret-scanning/alerts
```

### Scanner verification
- GitGuardian: wait for next scheduled scan (1-24h) or trigger manual rescan in dashboard
- GitHub Secret Scanning: alerts should auto-close or show "revoked"
- Mark incident as "Resolved" in scanner UI

---

## Phase 6: Post-Incident

1. **Document** in incident log: what leaked, when detected, rotation time, cleanup time
2. **Audit** other repos for same pattern (especially forks, mirrors)
3. **Prevent recurrence:**
   - Pre-commit hooks: `detect-secrets`, `git-secrets`, `trufflehog`
   - CI/CD secret scanning in pipeline
   - `.gitignore` template in repo init
   - Use `.env` + `dotenv` pattern, never commit config with secrets
4. **Update runbooks** with lessons learned

---

## Common Pitfalls

| Pitfall | Consequence | Fix |
|---------|-------------|-----|
| Clean git history **before** rotating keys | Key remains valid during cleanup window | **Rotate keys FIRST** |
| Use `git filter-branch` | Slow, breaks tags, loses history | Use `git-filter-repo` |
| Forget to re-add remote after filter-repo | Cannot push | `git remote add origin ...` |
| Force push without team coordination | Teammates' repos diverge | Announce in Slack/team, agree on time |
| Push new commit with secret after cleanup | Re-leak | `.gitignore` in place BEFORE new commits |
| Only clean master branch | Secret lives in other branches/tags | `git filter-repo` cleans all refs by default |
| Not verifying after cleanup | False confidence | Run verification commands above |

---

## Quick Reference Card

```
SECRET LEAK DETECTED
    │
    ▼
1. ROTATE KEYS (OpenRouter, HF, GitHub, etc.)  ← DO THIS FIRST
    │
    ▼
2. git filter-repo --path <file> --invert-paths --force
    │
    ▼
3. git remote add origin <url> && git fetch
    │
    ▼
4. echo "<file>" >> .gitignore && git add .gitignore && git commit
    │
    ▼
5. git push origin master --force  (coordinate with team!)
    │
    ▼
6. VERIFY: local scan + gh api + scanner dashboard
    │
    ▼
7. DOCUMENT + PREVENT (pre-commit hooks, CI scanning)
```

---

## References

- `references/git-filter-repo-cheatsheet.md` — common filter-repo patterns
- `references/secret-scanners.md` — GitGuardian, GitHub, TruffleHog, detect-secrets config
- `references/key-rotation-urls.md` — consolidated provider rotation links
