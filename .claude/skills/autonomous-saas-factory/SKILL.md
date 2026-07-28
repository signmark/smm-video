---
name: autonomous-saas-factory
description: "Playbook for orchestrating and building an autonomous micro-SaaS factory. Covers scaffolding, automated feature generation, type synchronization, multi-agent codegen, automated deployment, and algorithmic trend scouting."
version: 1.1.0
author: Dmitry + Hermes
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [saas, venture-builder, automated-codegen, boilerplate, type-safety, fast-crud, trend-scouting, lead-generation]
    related_skills: [oauth-token-management, subagent-driven-development, writing-plans]
    linked_files:
      - references/free-ai-apis-2026.md
      - references/leads-qualification-directus.md
      - references/saas-farm-notion-layout.md
      - references/georgia-ip-stripe.md
---

# 🚀 Autonomous SaaS Factory & Venture Builder Playbook

## Overview
An **Autonomous SaaS Factory** is a highly automated system designed to validate and launch micro-SaaS products rapidly (within hours or days) by orchestrating AI agents, reusable boilerplates, and automated marketing tools. Instead of building products manually, the engineer acts as a high-level system architect, while AI sub-agents handle scaffolding, domain feature codegen, client synchronization, deployment, and marketing.

## Core Pillars of the SaaS Factory

```
[ Идея / Спецификация ]
         │
         ▼
[ 1. СКАФФОЛДИНГ (Шаблонизатор) ]
   - Clone boilerplate, configure ports, name, and environment.
         │
         ▼
[ 2. АВТО-ГЕНЕРАЦИЯ ФИЧ (AI Codegen) ]
   - Multi-agent or single-agent feature generation in isolated git worktrees.
         │
         ▼
[ 3. СИНХРОНИЗАЦИЯ ТИПОВ (OpenAPI -> Client SDK) ]
   - Auto-generate TypeScript client directly from the FastAPI/backend OpenAPI schema.
         │
         ▼
[ 4. АВТО-ДЕПЛОЙ (Docker & Reverse Proxy) ]
   - Generate docker-compose, bind ports, configure Nginx/Traefik, provision SSL.
         │
         ▼
[ 5. АВТО-МАРКЕТИНГ (SMM Manager / video-app) ]
   - Generate viral Shorts/Reels/posts and inject ads on owned Telegram/social networks.
         │
         ▼
[ 6. ЧАСОВОЙ (Venture Keep or Kill Watchdog) ]
   - Background cron monitors stripe/payments. If active and profitable, keep; if inactive, auto-teardown.
```

### Viral Content Script Pipeline (Pillar 5 — Auto-Marketing)

A key input for SMM Manager's Shorts/Reels generation is **real viral scripts** scraped from YouTube and Instagram. Instead of generating content in a vacuum, the pipeline:

1. **Scrape** — use `scripts/scrape_viral_scripts.py` to find viral Shorts/Reels by search query or direct URL
2. **Extract** — grab YouTube auto-transcripts (no auth needed) or Instagram captions as raw script text
3. **Save** — structured JSON with metadata (views, channel, duration) to `smm-video/data/viral_*.json`
4. **Feed** — SMM Manager reads the JSON and uses the scripts as templates/prompts for AI video generation

**The scraper tool** (at `$HERMES_HOME/scripts/scrape_viral_scripts.py` or via skill script):
```
python3 scrape_viral_scripts.py "бизнес идеи" --youtube 5 --urls https://youtube.com/watch?v=XXXX
```

**Technical notes:**
- YouTube transcripts via `youtube-transcript-api` (no cookies, no captcha for transcript extraction)
- YouTube search may return captcha — use `--urls` with specific video URLs as fallback
- `YouTubeTranscriptApi().fetch(video_id, languages=["ru", "en"])` — note the instance method syntax (not class method)
- Instagram via `instaloader` (anonymous, hashtag-based search)
- yt-dlp requires cookies for `extract_info` — avoid for metadata; use HTML page parse instead
- Output saves to `$SMM_VIDEO/data/viral_*.json` for the SMM Manager content pipeline

---

## 1. The "Golden Boilerplate" Architecture (`saas-template`)
The efficiency of AI codegen is heavily determined by the boilerplate's architecture. The optimal stack for high-speed AI feature generation is a monorepo with an async backend and a type-safe client-sync pipeline:

### Tech Stack:
- **Backend:** Python (FastAPI, SQLAlchemy Async, Celery, Redis) managed via **uv**.
- **Frontend:** React + Next.js (TanStack Query, Zustand, Tailwind CSS, shadcn/ui) managed via **pnpm**.
- **Shared Client SDK (`packages/api-client`):** Local workspace dependency.

### The OpenAPI Auto-Client Pattern (CRITICAL):
1. **Do not let the AI write direct API fetchers** — they will inevitably drift from the backend schema and cause typing issues.
2. Maintain a script (e.g., `export_openapi.py`) that dumps the FastAPI OpenAPI schema.
3. Automatically run a generator (like `openapi-typescript-codegen` or `@openapitools/openapi-generator-cli`) to compile the TypeScript client inside `packages/api-client`.
4. Frontends can now import the client:
   ```typescript
   import { AuthService, UsersService } from '@saas/api-client';
   ```
This reduces AI frontend generation time by 90% and ensures compile-time type-safety.

## 2. Multi-Agent 2-Stage Development Workflow (Architect & Executor)
To prevent prompt drift and "code hallucinations" on complex additions:
- **Stage 1: Architect (Orchestrator)**
  - Writes a comprehensive `FEATURE_SPEC.md` or updates `todo.md` in the repo.
  - Reviews type definitions and verifies database models.
  - Initiates Stage 2 execution.
- **Stage 2: Executor (Sub-agents or Claude CLI)**
  - Runs in an isolated Git worktree (`git worktree add`) to avoid workspace pollution.
  - Implements the code strictly following the `FEATURE_SPEC.md`.
  - Runs formatting, linting, type-checking, and tests (`ruff`, `tsc`, `pytest`).
  - Reports status back with exact logs and code diffs.

### 2.1. Standalone Agent-First Workstations (Claude Code & Google Antigravity 2.0)
Modern Vibe Coding leverages standalone, terminal-driven agent frameworks that operate independently of traditional heavy IDE extensions.
* **Claude Code / Codex CLI:** Anthropic's terminal-based coding assistant for fast, direct, multi-file editing, test-driven debugging, and CLI execution.
* **Google Antigravity 2.0 (PyPI: `google-antigravity`):** Google's standalone Agent-first command center, CLI, and SDK designed for launching, monitoring, and orchestrating autonomous agent instances. Highly optimized for multi-agent parallelism using Gemini 3.5 models.
  * *Installation:* Can be installed via `pip install google-antigravity`.
  * *Workflow:* Functions as a central command station for automated keyboard-driven execution and multi-agent pipelines, copying the successful standalone UX of Claude Code.

## 3. Algorithmic Trend Scouting (SaaS Sniper Scout)
To avoid spending time on useless ideas, the SaaS factory uses automated crawlers to detect active user pains, market demands, and monetization signals.

### Scout Sources & Extraction Strategy:
- **HackerNews (Global Tech Trends):** Parse `https://hacker-news.firebaseio.com/v0/topstories.json` for hot indiehacker tech products and "Show HN" posts. Look at the comments density.
- **VC.ru (Local Tech & Business):** Parse the popular RSS feed (`https://vc.ru/rss`) to find regional business pain points, payment bottlenecks, and local SaaS niches.
- **Google Trends (Mass Search Demand):** Parse `https://trends.google.com/trending/rss?geo=US` or `RU` to capture rising consumer search topics.
- **TGstat Categories (Ad Spend & Budget Density):** Parse category pages on `tgstat.ru` (e.g., `/channels/business`, `/channels/marketing`) to see which categories have the highest CPM, engagement, and growth.

*A ready-to-run python script implementing HN, VC, and Google Trends is packaged inside this skill at `scripts/scout.py`. Use it as a starting point.*

## 4. Telegram Channel Intel & Trend Scouting — MIGRATED (2026-06-13)

> **Весь пайплайн Telegram-скаутинга заменён навыком `morning-scout-run`.**

**Новый пайплайн (`morning-scout-run`):**
| Этап | Навык / Скрипт | Что делает |
|------|----------------|-----------|
| Fetch | `batch_scout.py` (Telethon) | 5 постов/канал, skip Hidden/Redirect |
| Dedup | `scout_state.json` | Фильтрация по `post_id` — убирает дубли ×20 |
| Classify | `morning_scout.py` | LLM (OpenRouter `openrouter/auto`) + keyword fallback, 6 категорий |
| Format | `format_digest.py` | Markdown-дайджест, группировка по категориям |
| Send | `run_morning_scout.sh` | Pipeline wrapper, cron `0 3 * * *`, deliver → Telegram |

**Устаревшие скрипты (удаляются из `templates/`):**

| Старый скрипт | Замена | Примечание |
|---------------|--------|-----------|
| `templates/read_tg_channel.py` | `batch_scout.py` | BeautifulSoup-скрапинг → Telethon API (надёжнее) |
| `templates/get_tg_metadata.py` | `batch_scout.py` | Zero-dependency extractor → встроено в batch |
| `templates/get_empire_digest.py` | `morning_scout.py` | Параллельный fetch → LLM-классификация |
| `templates/watch_telegram_channels.py` | `batch_scout.py` | Ad-hoc мониторинг → единый cron |
| `templates/run_ai_scout.sh` | `run_morning_scout.sh` | Нет env-проверок → full pipeline wrapper |

#### Архив: Quiet Watchdog Blueprint (старая версия, до 2026-06-13)
To capture trends, product updates, and advertising opportunities from niche Telegram channels without paying for API tokens or leaking credentials:
- **Headless Scraper (`read_tg_channel.py`):** Uses `BeautifulSoup` to scrape `https://t.me/s/<channel>`, which provides a fully public HTML representation of any public Telegram channel. It cleans and converts HTML tags (bold, italics, pre, anchors) directly into clean Markdown natively.
- **Zero-Dependency Metadata Extractor (`get_tg_metadata.py`):** For quick channel verification and discovery without heavy parsing libraries, use a pure Python `urllib.request` + `re` regex extractor on the standard public URL `https://t.me/<username>`. By targeting `<meta property="og:title">`, `<meta property="og:description">`, and class `"tgme_page_extra"` for subscriber count, you can instantly fetch channel bios and popularity metrics.
- **Stateful Multi-Channel Aggregator (`get_empire_digest.py`):** ⚠️ **DEPRECATED / LOST.** Read a list of target channels from `empire_channels.txt` and fetched posts in parallel using `ThreadPoolExecutor` (max 15 workers). Checked a state file (`scout_state.json`) to filter out previously seen posts (filtering by `post_id > last_seen_id`).
- **Quiet Watchdog Cron Pattern (`run_ai_scout.sh`):** Scheduled as a Hermes cron job that runs a shell wrapper. By design, if there are no new posts, the python script outputs an empty string. The cron engine intercepts the empty stdout and remains completely silent (watchdog pattern).

**Why the switch?**
1. **Stability:** Telethon API is more reliable than HTML scraping (Telegram changes frontend markup without notice).
2. **Dedup:** The old `get_empire_digest.py` had a race condition causing 20× duplicate posts. New `batch_scout.py` uses per-channel `post_id` state.
3. **Classification:** Old pipeline used keyword matching ("Прочее" for everything). New pipeline uses LLM (OpenRouter) for 6-category classification.
4. **Maintenance:** Dead scripts cluttered the repo. Single pipeline (`morning-scout-run`) is the sole source of truth.

**The watchdog pattern is preserved** — `run_morning_scout.sh` outputs empty string when no new posts, and the cron engine stays silent.

## 5. SaaS Farm Notion Hub Synchronization
For detailed documentation on page nesting, parent-child structures, page UUIDs (e.g., parent `29cb5834-5579-4746-b347-651ce3982dac`), and the custom markdown proxy PATCH format used to maintain the workspace, see the companion guide [saas-farm-notion-layout.md](references/saas-farm-notion-layout.md).

## 6. Zero-Dependency Conversational AI Assistants (Telegram Companion)
For building fast interactive helpers, workspace notification receivers, or direct AI companion interfaces on Telegram without heavy dependency overhead:
- **Zero-Dependency Bot Core (`templates/hermes_telegram_bot.js`):** A native, modern Node.js bot utilizing the async fetch loop to long-poll updates. It maintains separate in-memory chat histories with customizable context-limit sliding windows (`CONTEXT_LIMIT`) and routes requests to OpenAI-compatible proxies (such as local OmniRoute or reverse-proxied domains).
- **Daemon Lifecycle via PM2:** To keep the bot running indefinitely on a host, wrap execution under PM2 process managers to handle socket drops, API throttling, or remote server reboots seamlessly:
  ```bash
  # Start the background daemon
  TG_BOT_TOKEN="your_token" API_BASE_URL="https://omni.yourdomain.com/v1" pm2 start templates/hermes_telegram_bot.js --name "hermes-tg-bot"

  # Ensure the process survives system restarts
  pm2 save
  ```
- **Context Compaction:** System prompts are dynamically combined with the active message context window. Command `/start` or `/clear` explicitly wipes the in-memory chat history array to reset the conversational context.

## 7. Three-Way Insights Publishing (Notion, Obsidian, Git)
To ensure complete continuity of parsed market and tech trends, the AI-scout must immediately synchronize high-value insights across three targets:
- **Notion (SaaS Farm Hub):** Insert the latest digests at the top of the main insights page via custom markdown PATCH requests, preserving historical content underneath.
- **Obsidian (Local Vault):** Document the day's insights directly in the daily note `YYYY-MM-DD.md` in the root or daily folder to enrich local semantic retrieval.
- **Git / Local logs:** Append the raw post data and processed insights into chronological files inside the `digests/` directory, and trigger `backup.sh` immediately to push the workspace state to the remote repository. Always apply `sed` pattern-matching or similar sanitizers during copy/backup phases to guarantee no raw API secrets or tokens are pushed to GitHub.

## 8. Live Custom Multi-Agent Team (Production — Preferred)

The user runs a **custom multi-agent team** via Hermes subagents. This is the primary setup — not MetaGPT. Always default here for multi-agent work.

**Team Roster:**

| Role | Name | Focus |
|------|------|-------|
| PM / Architect | Кира | Coordination, architecture, spec writing, code review |
| Marketing | Алекс | SMM, content strategy, landing copy, lead gen |
| Development | Влад | Feature implementation, code gen, debugging, testing |
| Sales | Ярослав | Lead qualification, funnel, deal flow, pitching |

**Key notes:**
- Each agent = Hermes `delegate_task`, shares the main agent's proxy/credentials
- Brainstorm outputs go to `@craft_podium` (private dev log)
- Parallel workstreams via `tasks=[...]` on `delegate_task`
- No MetaGPT sandbox — work happens in the actual project repos
- Process: Кира writes spec → Vlad implements → Кира reviews → Ярослав validates business angle

## 9. MetaGPT Multi-Agent Brainstorm Orchestration (Alternative)
For dynamic team discussions (e.g. brainstorming SaaS products, copy, or technical funnels) before writing specifications, use the MetaGPT multi-agent wrapper template:
- **Multi-Agent Script Template (`templates/multi_agent_brainstorm_template.py`):** Configures multiple roles with different focus areas (e.g. PM, Marketer, Developer) and runs interactive multi-turn debates. It aggregates responses and compiles them into a clean Markdown architecture/strategy specification document.
- **Real-Time Telegram Broadcasting (`templates/multi_agent_brainstorm_telegram.py`):** Dynamically publishes the ongoing live multi-agent dialogue and debate directly to a Telegram channel (e.g., `@craft_podium`) using standard Bot API message delivery, allowing real-time interactive audience engagement.
- **Local Proxy Routing:** Seamlessly directs calls to local proxies (such as OmniRoute running on port 20128) by declaring `base_url: "http://localhost:20128/v1"` in `~/.metagpt/config2.yaml`, letting you use advanced models (like `antigravity/claude-sonnet-4-6`) securely.

## 10. Automated Comments Leads Qualification (Directus & PostgreSQL)
For high-value automated lead generation from social media and channel comments, integrate the qualification flow directly into a PostgreSQL/Directus environment:
- **Failsafe DB & Schema:** Create the `leads_qualification` table in the same PostgreSQL database as Directus. Utilize unique indexes to prevent processing duplicates.
- **Multi-Provider Cascading Fallback:** Avoid single-point-of-failure API limits by routing requests through a cascading chain of AI providers (OpenRouter -> OpenAI -> direct Gemini API).
- **Directus Interface Mapping:** Once created in PostgreSQL, discover the table inside Directus Settings to expose it instantly to business managers for review and actions.
- **Cross-Environment Sync (Prod-to-Dev):** To preserve strict environment boundaries and protect production stability, *never* run experiment scripts directly on production. Instead, use a high-performance cross-environment sync script ([Prod-to-Dev Sync Template](templates/sync_prod_to_dev.py)) to stream comments from the production database container directly into your dev database container over a secure SSH-to-STDOUT CSV pipeline. Perform all qualifications and model testing safely in the dev environment.

**Reference & Templates:** See [Directus-Compatible Leads Qualification Guide](references/leads-qualification-directus.md), use the [PostgreSQL Leads Qualification CLI Template](templates/qualify_leads_postgres.py) for the engine, the [Directus Table Auto-Registration Script](templates/register_directus.py) to programmatically register collections/presets, and the [High-Performance Parallel Enrichment Script](templates/enrich_historical.py) for lightning-fast multi-threaded retro-enrichment of qualified leads.

#### High-Performance Parallel Retro-Enrichment Pattern:
When retroactively enriching large datasets (e.g., populating newly added columns like `target_product` or `extracted_needs` across thousands of already qualified records), sequential processing is a massive bottleneck.
- **The Concurrency Fix:** Implement `concurrent.futures.ThreadPoolExecutor` using thread-safe connection pools (or thread-local DB connections) to query high-throughput LLM endpoints (like `gemini-2.5-flash` on OpenRouter) in parallel.
- **Tuning Threads:** OpenRouter/Gemini easily handles 15–25 parallel worker threads, shifting processing speeds from ~0.5 leads/sec to **over 25 leads/sec** (enabling 1,000+ enrichments in less than a minute).
- **Graceful Partial Fallbacks:** Ensure the LLM prompt returns a structured fallback (like `Не определено`) if context is missing, preventing database `NULL` or schema mismatches. Use target update queries that only touch the newly enriched columns to preserve the integrity of original statuses.

## 11. Venture Lifecycle Watchdog (Keep or Kill)
A background cron job runs every 24 hours and evaluates each spawned SaaS instance:
- **Metrics checked:** Total payment transactions, active user retention, error rate.
- **Decision Matrix:**
  - **Revenue > $50/week** OR **Active retention > 10%** -> **KEEP** (continue automated marketing, add detailed features).
  - **Revenue = $0/week** AND **Time > 14 days** -> **KILL** (run automated teardown).
- **Teardown procedure:**
  1. Export Postgres/SQLite databases to safe S3 storage (`backups/`).
  2. Run `docker compose down -v` to purge container resources.
  3. Release ports from Traefik/Nginx reverse proxy.
  4. Archive domain DNS records.

## Common Pitfalls
1. **Letting the AI write direct SQL schema changes:** Always use database migrations (e.g., Alembic, Knex, or Directus Schema sync) to prevent unsynced databases across dev/prod environments.
2. **Deploying without sandboxing:** If projects are not fully containerized, a buggy script in project A can exhaust disk space, memory, or crash the global reverse proxy. Always set CPU/memory limits in `docker-compose`.
3. **Docker-Compose Volume Mounting Overriding Container Code/Node Modules in Multi-Stage Builds:**
   - *Symptom:* Container fails with `Cannot find module '/app/server/index.ts'` or similar, and continuously restarts even though the codebase is complete and the build succeeds in the Docker-builder stage.
   - *Cause:* Having a volume mount in `docker-compose.yml` (such as `volumes: - ./smm:/app`) will override the container's `/app` folder (where the built `/app/dist` or production `node_modules` were created in the Multi-Stage build) with the host's `./smm` folder, which lacks these built production folders or uses a different structure.
   - *Solution:* In production/release compositions, remove the local volume mounting entirely. Let the container run purely from the pre-built Docker image. Change `command` to `npm run start` and configure the container to use its internal production-compiled artifacts rather than mounting host paths.
4. **Skipping the "Kill" phase:** Letting stale projects run indefinitely accumulates technical debt and wastes host resources. Always enforce the 14-day Keep/Kill rule.
5. **Traefik SSL/ACME Failures due to Non-Existent Subdomains (NXDOMAIN) & Let's Encrypt Cooldowns:**
   - *Symptom:* Traefik fails to obtain or renew Let's Encrypt certificates, resulting in HTTPS browser warnings. Logs contain messages like `Unable to obtain ACME certificate: DNS problem: NXDOMAIN looking up A for omni.zhdanov.pw`.
   - *Cause:* Traefik routers automatically attempt to request a certificate as soon as the router configuration is detected or a container starts. If the A/AAAA/CNAME record for the domain has not been fully created or propagated yet, Let's Encrypt validation fails with an NXDOMAIN error. After **5 failed authorizations within a 1-hour window**, Let's Encrypt enforces a strict safety rate-limit/ban on that specific domain.
   - *Solution:*
     1. Create/verify the DNS records first and ensure propagation.
     2. If rate-limited, check Traefik logs to identify the rate-limit expiration timestamp.
     3. **Do not spam requests.** Wait until the rate-limit window has fully cleared.
     4. Once the window has expired, trigger a fresh ACME challenge by restarting the Traefik proxy.
6. **Docker Build Fails to COPY Local Configs due to `.dockerignore` Block:**
   - *Symptom:* Docker build fails with an error like `failed to calculate checksum ... "/nginx.conf": not found`.
   - *Cause:* Configuration files like `nginx.conf` are sometimes left in `.dockerignore`.
   - *Solution:* Audit `.dockerignore` and remove any files that the `Dockerfile` needs to `COPY` or `ADD`.
7. **WSL 2 Cross-OS Mount I/O Translation Bottlenecks & Binary Conflicts:**
   - *Symptom:* Package installations inside WSL on Windows mounts are extremely slow or hang.
   - *Cause:* File operations across the WSL-NTFS mount boundary have a severe translation penalty.
   - *Solution:* Move the entire development repository into the WSL native ext4 filesystem.
8. **Fetch Request Interceptors and Read-Only Headers in Type-Safe Clients:**
   - *Symptom:* Adding a bearer token in request interceptors triggers a TypeScript compile error.
   - *Cause:* Modern type-safe fetch clients type request headers as `readonly`.
   - *Solution:* Mutate headers directly using the Web API standard `.set` method.
9. **Next.js Static Export Hydration Crashes (`location is not defined`):**
   - *Symptom:* Running `next build` crashes with `ReferenceError: location is not defined`.
   - *Cause:* Executing client-side navigation during rendering.
   - *Solution:* Defer all redirects and client-only logic to `useEffect` hooks.
10. **Next.js Suspense Boundaries for Client-Side Search Parameters:**
    - *Symptom:* `next build` fails with `useSearchParams() should be wrapped in a suspense boundary`.
    - *Cause:* Reading query parameters деоптимизирует static pre-rendering.
    - *Solution:* Isolate search params reading into a child component wrapped in `<Suspense>`.
11. **Telegram Web Previews Redirect Limitation:**
    - *Symptom:* Added channels are ignored or returned as 0 posts.
    - *Cause:* Some Telegram channels have strict privacy settings that redirect `t.me/s/username` to `t.me/username`, which lacks public post widgets.
    - *Solution:* Check for redirects. These channels require Telethon userbot or bot API.
12. **Resolving Unstructured Telegram Channel Pastes:**
    - *Symptom:* User shares an interesting pasted post without a username/link.
    - *Cause:* Web search engines on server IP are rate-limited.
    - *Solution:*
      1. Check local gateway logs for `forward_from_chat` fields or button URLs.
      2. Search back pages of established similar channels.
      3. Use SOCKS5 proxy fallback for clean IPv4 routing.
13. **Git Secret Blocks & Push Protection Recovery:**
    - *Symptom:* Git push rejected due to secrets committed in history.
    - *Cause:* Hardcoding API keys in committed files.
    - *Solution:*
      1. `git reset --soft origin/master`
      2. Redact credentials.
      3. Patch sync scripts to auto-redact using `sed`.
14. **Notion Custom Markdown Proxy PATCH Payload:**
    - *Symptom:* PATCH request to Notion proxy returns 400.
    - *Cause:* Endpoint expects structured transaction payload.
    - *Solution:* Wrap in `{"type":"replace_content","replace_content":{"new_str":"..."}}`.
15. **SQLite Schema Migration on WSL/NTFS:**
    - *Symptom:* Database crashes with validation errors after schema changes.
    - *Solution:* Direct `sqlite3` ALTER TABLE + Pydantic `Optional[T] = None` for backward compat.
16. **Git LFS Push Failures:**
    - *Solution:* `sudo apt-get install git-lfs && git lfs install`.
17. **Vercel Monorepo SPA Routing:**
    - *Solution:* `vercel.json` rewrites excluding static/blog paths.
18. **Accidental `requirements.txt` in Frontend:**
    - *Solution:* Delete stray `requirements.txt` from client dir.
19. **SQLite Single-File Volume Mounting:**
    - *Solution:* `touch` file before `docker compose up`.
20. **`NGROK_URL` Environment Poisoning:**
    - *Solution:* Delete `NGROK_URL` in production `.env`.
21. **FastAPI Traefik Labels Schema:**
    - *Solution:* Explicit TLS/ACME labels in `docker-compose.yml`.
22. **Adblocker ERR_BLOCKED_BY_CLIENT:**
    - *Solution:* Rename `/me` → `/api/v1/users/profile`.
23. **Next.js RSC Manifest ESM Routing:**
    - *Solution:* Upgrade Node.js to v22.22.2+.
24. **WSL Host Accessibility:**
    - *Solution:* Bind to `0.0.0.0`.
25. **Interactive CLI-Agent Interoperability:**
    - *Solution:* Use `os.execvpe` instead of `subprocess`.
26. **MetaGPT Stream Parsing Conflict:**
    - *Solution:* Handle pre-instantiated `CompletionUsage` objects.
27. **Gemini Sequence Alternation Conflict:**
    - *Solution:* Clear session state on pending tool call boundaries.
28. **Speculative Scope Creep:**
    - *Solution:* STRICT RULE: no autonomous branches without explicit alignment.

## 5. Топливный контур: Бесплатная ИИ-энергия (Free AI APIs Blueprint)

> *Для детальной сводки всех ИИ-провайдеров, лимитов, скоростей и бенчмарков см. [free-ai-apis-2026.md](references/free-ai-apis-2026.md).*

### 5.1. Карта ИИ-Реакторов (Ongoing Free Tiers)
- **Quality Burst:** Gemini 2.5 Pro, GPT-4o, DeepSeek R1 free
- **Workhorses:** Cerebras Qwen3 235B, SambaNova Llama 405B, NVIDIA NIM
- **Speed & Anonymity:** Groq Llama 3.3, LLM7, Kilo Gateway

### 5.2. Gemini Billing Credits
| Credit Type | Generativelanguage API? | Vertex AI? |
|-------------|------------------------|------------|
| Free Trial Upgrade | ✅ Yes | ✅ Yes |
| Gen App Builder Trial | ❌ No | ✅ Yes |
| Standard Free Trial | ✅ Yes (rate limits) | ✅ Yes |

### 5.3. Key Pooling & Rotation
Пул ключей в `freellmapi` с Round-Robin и отслеживанием 429.