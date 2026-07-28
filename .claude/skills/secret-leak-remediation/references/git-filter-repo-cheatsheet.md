# git-filter-repo Cheatsheet

Common patterns for secret remediation.

## Remove a specific file from all history
```bash
git filter-repo --path config.yaml --invert-paths --force
```

## Remove all files matching pattern
```bash
git filter-repo --path-glob "*.env" --invert-paths --force
git filter-repo --path-glob "*.key" --invert-paths --force
git filter-repo --path-glob "*secret*" --invert-paths --force
```

## Remove specific commit by hash
```bash
git filter-repo --commit-callback '
  if commit.original_id == b"739a7fae7709cd3d580fdaefdbecdbddcc2de001":
    commit.skip()
' --force
```

## Remove commits by author (if attacker committed)
```bash
git filter-repo --commit-callback '
  if commit.author_email == b"attacker@evil.com":
    commit.skip()
' --force
```

## Replace string in all files (e.g., replace real key with placeholder)
```bash
git filter-repo --replace-text ./replacements.txt
# replacements.txt format:
# ***==>***
# ***==>***
```

## Run in subdirectory
```bash
git filter-repo --subdirectory-filter path/to/subdir --force
```

## Preserve specific refs (tags, branches)
```bash
# Default: preserves all refs. To only clean specific branches:
git filter-repo --refs master,develop --force
```

## Dry run (see what would be removed)
```bash
git filter-repo --path config.yaml --invert-paths --dry-run
```

## After filter-repo: re-add remote
```bash
git remote add origin git@github.com:owner/repo.git
git fetch
```

## Verify cleanup
```bash
# File should not exist in any commit
git log --all --full-history -- config.yaml

# No secret patterns in history
git log --all --oneline -p | grep -i "sk-" | head -10

# Check all refs cleaned
git for-each-ref --format='%(refname)' | xargs -I{} git log {} --oneline -p | grep -i "sk-"
```

## Common pitfalls

| Issue | Fix |
|-------|-----|
| `git: 'filter-repo' is not a git command` | `pip3 install --break-system-packages git-filter-repo` |
| Remote removed | Re-add: `git remote add origin <url>` |
| Tags not cleaned | Default cleans tags. Use `--tag-rename` if needed |
| Submodules | Run filter-repo in each submodule separately |
| LFS files | Use `--lfs` flag or migrate LFS first |
