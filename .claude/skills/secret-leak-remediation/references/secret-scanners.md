# Secret Scanners Comparison & Config

Quick reference for the main secret detection tools.

## GitGuardian (SaaS, used in this incident)

- **Type:** Cloud SaaS + GitHub App
- **Scan:** Real-time on push + scheduled full repo scans
- **Incidents:** Web dashboard, email alerts, Slack/webhooks
- **Remediation UI:** "Revoke" button (calls provider API for some), "Ignore", "Fixed"
- **Free tier:** Public repos free, private repos paid
- **Config:** Install GitHub App → auto-scans all repos in org/user

## GitHub Secret Scanning (Native)

- **Type:** Built into GitHub (free for public, GHAS for private)
- **Patterns:** 200+ partner patterns + custom patterns
- **Alerts:** Security tab → Secret scanning alerts
- **Push protection:** Blocks push if secret detected (enable in repo settings)
- **Custom patterns:** Regex-based, defined at org/repo level
- **API:** REST + GraphQL for alert management

### Enable push protection
```
Settings → Security → Secret scanning → Push protection: Enable
```

### Custom pattern example (OpenRouter)
```
Pattern: sk-or-[a-zA-Z0-9]{32,}
```

## TruffleHog (Open Source, CLI/CI)

- **Type:** Local binary / Docker / GitHub Action
- **Scan:** `trufflehog git file://. --since-commit HEAD~100`
- **Entropy detection:** Finds high-entropy strings (good for unknown key formats)
- **Decoder:** Decodes/validates 700+ credential types
- **CI:** `trufflehog github --org=myorg --token=$GITHUB_TOKEN`

### GitHub Action
```yaml
- uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: main
    head: HEAD
```

## detect-secrets (Pre-commit, Python)

- **Type:** Pre-commit hook / local scanner
- **Install:** `pip install detect-secrets`
- **Baseline:** `detect-secrets scan > .secrets.baseline`
- **Hook:** Add to `.pre-commit-config.yaml`

```yaml
- repo: https://github.com/Yelp/detect-secrets
  rev: v1.5.0
  hooks:
    - id: detect-secrets
      args: ['--baseline', '.secrets.baseline']
```

## git-secrets (AWS-focused, simple)

- **Type:** Git hook / CLI
- **Install:** `git secrets --install`
- **Patterns:** Built-in AWS keys + custom
- **Scan:** `git secrets --scan-history`

## Recommended Stack (Defense in Depth)

| Layer | Tool | Purpose |
|-------|------|---------|
| **Pre-commit** | detect-secrets / git-secrets | Catch before commit |
| **CI/CD** | TruffleHog GitHub Action | Catch in PR/pipeline |
| **GitHub Native** | Secret Scanning + Push Protection | Real-time on push |
| **Org/Cloud** | GitGuardian | Dashboard, alerting, compliance |

## Scanner Verification Commands

```bash
# TruffleHog full history
trufflehog git file://. --since-commit HEAD~1000 --json

# detect-secrets scan current
detect-secrets scan

# GitHub API: list open alerts
gh api repos/owner/repo/secret-scanning/alerts --jq '.[] | {type: .secret_type, state: .state, url: .html_url}'
```

## Post-Cleanup Verification

After `git filter-repo` + force push:

```bash
# 1. Local: scan cleaned history
trufflehog git file://. --since-commit HEAD~1000

# 2. GitHub: verify file gone
gh api repos/owner/repo/contents/config.yaml
# Should return 404

# 3. GitGuardian: trigger rescan in dashboard or wait
# 4. GitHub Secret Scanning: check alerts auto-closed
gh api repos/owner/repo/secret-scanning/alerts
```
