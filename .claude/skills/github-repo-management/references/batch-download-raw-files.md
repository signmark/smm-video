# Batch Download Raw Files from a GitHub Repo

Pattern used in session (CL4R1T4S system prompts collection).

## When to Use

You need to download multiple raw files from a public GitHub repo (no auth needed for public repos) and save them locally with original filenames.

## Method: curl in a Loop

```bash
cd /target/directory

# List of paths relative to repo root (from GitHub web UI or API)
files=(
  "ANTHROPIC/CLAUDE-FABLE-5.md"
  "OPENAI/Atlas_10-21-25.txt"
  "CURSOR/Cursor_2.0_Sys_Prompt.txt"
  # ... more paths
)

base_url="https://raw.githubusercontent.com/owner/repo/main"

for f in "${files[@]}"; do
  name=$(basename "$f")
  curl -s -f "$base_url/$f" -o "$name" && echo "✅ $name" || echo "❌ $name"
done
```

## Discovering File Paths

1. **GitHub web UI**: Browse repo tree, note folder/file names
2. **GitHub API** (no auth for public): `curl -s https://api.github.com/repos/owner/repo/contents | jq -r '.[].path'`
3. **Tree API** (recursive): `curl -s https://api.github.com/repos/owner/repo/git/trees/main?recursive=1 | jq -r '.tree[].path'`

## Handling Subdirectories & Name Collisions

- Use `basename` to flatten — OK if all filenames are unique
- If collisions: preserve structure with `mkdir -p "$(dirname "$f")"` and save to relative path
- Or prefix with folder: `name="${f//\//-}"`

## Rate Limits

- Unauthenticated: 60 req/hour per IP (fine for ~30 files)
- Authenticated: 5000 req/hour (add `-H "Authorization: token $GITHUB_TOKEN"`)
- Add small `sleep 0.1` in loop if hitting limits

## Verification

```bash
# Count files
ls -1 | wc -l

# Check sizes (spot-check for empty/failed)
ls -la *.md *.txt

# Quick content check
head -5 *.md
```

## Example: CL4R1T4S (this session)

```bash
mkdir -p ~/hermes-vault/cl4r1t4s-prompts
cd ~/hermes-vault/cl4r1t4s-prompts

files=(
  "ANTHROPIC/CLAUDE-FABLE-5.md"
  "OPENAI/Atlas_10-21-25.txt"
  "CURSOR/Cursor_2.0_Sys_Prompt.txt"
  "GOOGLE/Gemini_Diffusion.md"
  "XAI/GROK-4.20.mkd"
  "PERPLEXITY/Perplexity_Deep_Research.txt"
  "WINDSURF/Windsurf_Prompt.md"
  "DEVIN/Devin2_09-08-2025.md"
  "MANUS/Manus_Prompt.txt"
  "REPLIT/Replit_Agent.md"
  "LOVABLE/Lovable_2.0.txt"
  "BOLT/Bolt.txt"
  "CLINE/Cline.md"              # actual: CLINE/Cline.md
  "CLUELY/Cluely.mkd"           # actual: CLUELY/Cluely.mkd
  "DIA/Dia_CodingSkill.txt"
  "DIA/Dia_DraftSkill.txt"
  "FACTORY/DROID.txt"           # actual: FACTORY/DROID.txt
  "HUME/Hume_Voice_AI.md"
  "META/Llama4_WhatsApp.txt"
  "META/Muse_Spark_Apr-08-26.txt"
  "MINIMAX/MiniMax.txt"
  "MISTRAL/LeChat.md"
  "MOONSHOT/Kimi_2_July-11-2025.txt"
  "MOONSHOT/Kimi_K2_Thinking.txt"
  "MULTION/MultiOn.md"
  "SAMEDEV/Same_Dev.txt"
  "BRAVE/LEO_Aug-31-2025"
)

base="https://raw.githubusercontent.com/elder-plinius/CL4R1T4S/main"
for f in "${files[@]}"; do
  name=$(basename "$f")
  curl -s -f "$base/$f" -o "$name" && echo "✅ $name" || echo "❌ $name"
done
```

> **Note**: Some files had different names than expected (e.g., `CLINE/Cline.md` not `CLINE/Cline_Prompt.md`). Always verify by checking the GitHub tree UI first.

## Alternative: gh cli (if available)

```bash
# gh doesn't have a direct "download raw file" command, but:
gh api repos/owner/repo/contents/path/to/file --jq '.content' | base64 -d > file
# Only works for single files, not batch-friendly
```

## Git Commit Pattern (User-Specific)

After downloading to vault:

```bash
cd /mnt/c/Users/signm/hermes-vault
git add cl4r1t4s-prompts/
git commit -m "feat: add full CL4R1T4S system prompts (27 files)"
git pull --rebase origin master  # if divergent
git push origin master
```

Local `.obsidian/*.json` changes are noise — stash or ignore before rebase.