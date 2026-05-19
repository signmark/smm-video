# Technical Specification — SMM Manager
**Version:** 1.0  
**Date:** March 2026  
**Status:** Production  
**Production URL:** https://smm.omemo.tech

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Goals and Objectives](#2-goals-and-objectives)
3. [Target Audience](#3-target-audience)
4. [Functional Requirements](#4-functional-requirements)
5. [System Architecture](#5-system-architecture)
6. [Data Model](#6-data-model)
7. [API Specification](#7-api-specification)
8. [AI Integrations](#8-ai-integrations)
9. [Social Media Platform Integrations](#9-social-media-platform-integrations)
10. [Authentication and Authorization](#10-authentication-and-authorization)
11. [Media Processing](#11-media-processing)
12. [Scheduling and Publication Pipeline](#12-scheduling-and-publication-pipeline)
13. [Analytics and Reporting](#13-analytics-and-reporting)
14. [User Interface Requirements](#14-user-interface-requirements)
15. [Internationalization](#15-internationalization)
16. [Security Requirements](#16-security-requirements)
17. [Non-Functional Requirements](#17-non-functional-requirements)
18. [Testing Requirements](#18-testing-requirements)
19. [Deployment Architecture](#19-deployment-architecture)
20. [External Dependencies](#20-external-dependencies)

---

## 1. Project Overview

**SMM Manager** is a comprehensive, AI-powered Social Media Management platform that enables individuals and teams to plan, generate, schedule, and publish content across multiple social media networks from a single interface.

The platform is built around three core pillars:

- **AI Content Generation** — Produce text, images, and captions using state-of-the-art language and image models.
- **Multi-Platform Publishing** — Publish to Instagram, YouTube, VK, Telegram, TikTok, Facebook, and Threads simultaneously.
- **Campaign Analytics** — Track performance metrics, collect trends, and generate export-ready reports.

The system also integrates a Telegram Bot and Telegram Mini App, allowing users to manage campaigns and generate content without leaving Telegram.

---

## 2. Goals and Objectives

| # | Goal | Metric |
|---|------|--------|
| 1 | Reduce content production time | Content creation in < 5 minutes per post via AI generation |
| 2 | Prevent duplicate publications | 6-layer deduplication system; 0 accidental duplicates |
| 3 | Support all major social networks | 7 platforms: Instagram, YouTube, VK, Telegram, TikTok, Facebook, Threads |
| 4 | Enable autonomous AI workflows | AI Assistant executes multi-step campaigns with no manual input |
| 5 | Provide actionable analytics | Real-time dashboards + PDF/Excel exports per campaign |
| 6 | Monetize via subscriptions | Stripe / ЮKassa paywall with pricing plans |

---

## 3. Target Audience

- **Individual content creators** managing personal brand accounts
- **SMM managers** at agencies handling multiple clients
- **Small and medium businesses** needing automated social media presence
- **Telegram channel owners** building and monetizing communities

---

## 4. Functional Requirements

### 4.1 Authentication

- Email/password login via Directus
- JWT access tokens with automatic silent refresh every 60 seconds
- Exponential backoff retry with jitter (1s–30s) on failed refreshes
- 24-hour session persistence without re-login
- Unified auth across web UI and Telegram Bot
- Protected routes redirect unauthenticated users to `/auth/login`
- Public routes: `/auth/login`, `/auth/register`, `/pricing`

### 4.2 Campaign Management

- Create, read, update, delete marketing campaigns
- Each campaign has: name, website URL, description, keywords, social platform tokens
- Auto-analyze website on creation (extracts brand info via AI)
- Auto-fill business questionnaire from website analysis
- Campaign status indicator (questionnaire completion progress, green/yellow checks)
- Multiple campaigns per user; campaign switcher in content views
- Campaign-level API key storage (per-platform tokens: Telegram, VK, Instagram, YouTube, Facebook, TikTok)

### 4.3 Content Management

- Create content items of types: **text + image**, **text only**, **carousel**, **video**, **reel**, **story**
- Rich text editing via Tiptap editor
- Content statuses: `draft` → `scheduled` → `publishing` → `published` / `failed` / `partial`
- Content list with filtering by campaign, platform, status, and date
- Bulk operations: delete, reschedule, duplicate
- Unpublish content from social platforms (where API supports it)

### 4.4 AI Content Generation

- **Text generation** using: Gemini 3.0 Pro, Gemini 2.5 Flash, DeepSeek, Claude (Anthropic), Qwen
- **Image generation** using: FAL.AI (Flux, Schnell, LoRA models)
- Prompt-based generation with optional keyword injection from campaign trends
- Brand Voice system: AI adapts tone using business questionnaire data
- Autonomous mode: AI generates 8 content types per session based on active trends
- Generation history stored per content item in Directus

### 4.5 Story Editor

- Canvas-based visual editor for Instagram/VK Stories
- Add text layers, sticker overlays, and background images
- Supports 9:16 format (1080×1920)
- Export as JPEG with blurred background fill for non-standard aspect ratios
- Preview generation via `/api/stories/generate-preview`
- Upload to Beget S3; URL passed to publishing pipeline

### 4.6 Scheduling

- Visual calendar view for planned publications
- Set publish date/time per content item
- Content without a scheduled time publishes immediately on trigger
- Scheduler runs every 30 seconds, processes `scheduled`, `pending`, `partial` statuses
- Immediate trigger on "Publish" button click (no 30-second wait)
- Missed schedule detection and re-queue logic

### 4.7 Multi-Platform Publishing

Publishing is orchestrated via n8n workflows for most platforms. The server fires a webhook and returns immediately (fire-and-forget). n8n is the source of truth for writing `social_platforms` data back to Directus.

| Platform | Content Types | Publishing Path |
|----------|--------------|----------------|
| Instagram | Posts, Reels, Stories, Carousels | n8n → Instagram Graph API |
| YouTube | Videos, Shorts | n8n → YouTube Data API |
| Telegram | Posts with media | n8n → Telegram Bot API |
| Facebook | Page posts, Group posts | n8n → Facebook Graph API |
| VK | Posts, Clips | n8n → VK API |
| VK Stories | Stories | Direct server call (exception) |
| TikTok | Videos | n8n → TikTok Content Posting API |
| Threads | Text posts | Direct server service (`threads-service.ts`) |

### 4.8 Analytics

- Per-campaign dashboard: reach, engagement, follower growth
- Cross-platform aggregated metrics
- Trend lines using Recharts / Nivo charts
- Comment collection from connected platforms
- AI-powered sentiment analysis per post/campaign
- Keyword performance tracking (volume, trend score)
- Export analytics as PDF (cover page + charts) or Excel

### 4.9 Trends

- Website crawler extracts product/service keywords
- N8N collects platform trends on demand
- Global AI Trends: Gemini discovers trending topics by campaign theme
- Trend list with source, search volume, deduplication
- AI trends prefixed with `"AI:"` and excluded from duplicate detection
- Trends feed into AI content generation as keyword context

### 4.10 Telegram Bot

- Commands: `/start`, `/campaigns`, `/content`, `/generate`, `/analytics`, `/settings`
- Authentication synchronized with web session (Directus tokens)
- Campaign management from Telegram
- AI content and image generation directly in chat
- Voice message transcription (Gemini 2.0 Flash Speech-to-Text)
- AI Assistant with persistent chat history per user
- Inline keyboard menus for navigation

### 4.11 Telegram Mini App

- Full web application embedded in Telegram via Bot Menu
- Automatic authentication using Telegram WebApp init data
- Identical feature set to web UI
- Native Telegram theme integration (dark/light follows system)

### 4.12 AI Assistant

- Conversational interface (floating widget + Telegram Bot)
- Multi-step autonomous plans: `[{"action":"collect_trends"}, {"action":"generate_content", ...}]`
- Navigation intent detection: user can say "go to analytics" → app navigates
- Web search integration for up-to-date knowledge
- Persistent conversation history in localStorage (web) and Directus (Telegram)
- Strict system prompts to prevent off-topic responses

### 4.13 Keywords and SEO Tools

- `/keywords/:campaignId` — manage campaign keywords
- Keyword volume, trend score, category tagging
- Integration with content generation as context injection

### 4.14 User Profile and Settings

- Edit first name, last name, email, avatar
- Change password
- Language preference (RU / EN / ES)
- Dark/light theme preference
- Notification settings

### 4.15 Admin Panel

- User management (list, suspend, delete)
- Global API key configuration for all AI and social services
- Per-campaign API key override
- System health dashboard
- Publication logs viewer

### 4.16 Pricing and Monetization

- Public `/pricing` page (no auth required)
- Subscription tiers with feature limits
- Payment via Stripe and/or ЮKassa
- Paywall enforcement in `AuthGuard`

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT (React SPA)                  │
│  Vite + TypeScript + TailwindCSS + Shadcn UI            │
│  TanStack Query │ Wouter │ Tiptap │ Recharts/Nivo       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS REST
┌────────────────────────▼────────────────────────────────┐
│                  EXPRESS SERVER (Node.js)                 │
│  Authentication │ AI Orchestration │ Media Proxy         │
│  Scheduler │ WebSocket │ Webhook Receiver                │
└──────┬────────────┬────────────────┬───────────────┬────┘
       │            │                │               │
  ┌────▼────┐  ┌────▼────┐    ┌─────▼──────┐  ┌────▼────┐
  │Directus │  │ n8n     │    │ AI Services│  │ Beget S3│
  │  CMS    │  │Workflow │    │Gemini/     │  │ Storage │
  │(Postgres│  │Automation    │Claude/     │  │         │
  │   DB)   │  │         │    │DeepSeek/   │  └─────────┘
  └─────────┘  └────┬────┘    │FAL.AI/Qwen │
                    │         └────────────┘
         ┌──────────▼──────────────────┐
         │  Social Media Platform APIs  │
         │  Instagram │ YouTube │ VK    │
         │  Telegram  │ TikTok  │ FB   │
         └─────────────────────────────┘
```

### 5.1 Frontend Architecture

- **SPA** served by Vite dev server (development) or Express static (production)
- **Routing**: Wouter with `AuthGuard` HOC wrapping all protected routes
- **State**: TanStack Query for server state; React Context for auth, theme, language
- **UI Components**: Shadcn UI (Radix primitives + Tailwind)
- **PWA**: manifest.json + Service Worker for offline caching

### 5.2 Backend Architecture

- **Framework**: Express 4.x on Node.js 20+
- **Language**: TypeScript (compiled with `tsx` in dev, `tsc` in prod build)
- **Route structure**: `/server/routes/` — modular routers mounted on `/api/`
- **Service layer**: `/server/services/` — business logic isolated from routes
- **Storage abstraction**: `/server/storage.ts` — `IStorage` interface over Directus
- **All Directus access**: via `directusCrud` service using admin token

### 5.3 Data Flow: Content Publishing

```
User clicks "Publish"
  → POST /api/publish/scheduled
    → publish-scheduler.ts picks up item
      → POST n8n webhook (fire-and-forget)
        → n8n processes → Social API
          → n8n PATCH Directus social_platforms field
            → Frontend polls status via GET /api/campaign-content/:id/status
```

---

## 6. Data Model

All data is stored in Directus (PostgreSQL). Key collections:

### 6.1 `user_campaigns`

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| user_id | FK → directus_users | Owner |
| name | string | Campaign name |
| website | string | Brand website URL |
| description | text | Campaign description |
| api_keys | JSON | Per-platform tokens |
| status | enum | active / archived |
| created_at | timestamp | |

### 6.2 `campaign_content`

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| campaign_id | FK → user_campaigns | Parent campaign |
| title | string | Content title |
| content | text | Rich HTML body |
| content_type | enum | text, text_with_image, carousel, video, reel, story |
| status | enum | draft, scheduled, publishing, published, failed, partial |
| scheduled_at | timestamp | Publish time (null = immediate) |
| social_platforms | JSON | Per-platform publish results |
| images | JSON | Array of uploaded image URLs |
| generated_by | string | AI model used |
| created_at | timestamp | |

### 6.3 `business_questionnaire`

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| campaign_id | FK | One-to-one with campaign |
| business_type | string | |
| target_audience | text | |
| brand_voice | text | Tone-of-voice description |
| competitors | text | |
| unique_value | text | USP |
| goals | text | |
| filled_by_ai | boolean | Was auto-filled |

### 6.4 `campaign_keywords`

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| campaign_id | FK | |
| keyword | string | |
| volume | integer | Monthly search volume |
| trend_score | float | 0–1 trend relevance |
| source | string | source name |
| category | string | |

### 6.5 `social_platforms` (JSON field inside `campaign_content`)

```json
{
  "instagram": {
    "postId": "12345",
    "status": "published",
    "postUrl": "https://instagram.com/p/...",
    "platform": "instagram",
    "publishedAt": "2026-03-01T12:00:00Z",
    "type": "post"
  },
  "vk": { ... },
  "telegram": { ... }
}
```

---

## 7. API Specification

Base path: `/api`  
All authenticated endpoints require `Authorization: Bearer <access_token>` header.

### 7.1 Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login with email + password → returns access_token |
| POST | `/auth/register` | Register new user |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/me` | Get current user profile |
| POST | `/auth/logout` | Invalidate session |

### 7.2 Campaigns

| Method | Path | Description |
|--------|------|-------------|
| GET | `/campaigns` | List all campaigns for current user |
| POST | `/campaigns` | Create new campaign |
| GET | `/campaigns/:id` | Get campaign details |
| PATCH | `/campaigns/:id` | Update campaign |
| DELETE | `/campaigns/:id` | Delete campaign |

### 7.3 Campaign Content

| Method | Path | Description |
|--------|------|-------------|
| GET | `/campaign-content` | List content (filter by campaignId, status, platform) |
| POST | `/campaign-content` | Create content item |
| GET | `/campaign-content/:id` | Get single content item |
| PATCH | `/campaign-content/:id` | Update content item |
| DELETE | `/campaign-content/:id` | Delete content item |
| GET | `/campaign-content/:id/status` | Poll publication status |

### 7.4 Publishing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/publish/scheduled` | Trigger immediate publish or schedule |
| GET | `/publish/scheduled` | List scheduled publications |
| DELETE | `/publish/scheduled/:id` | Cancel scheduled publication |

### 7.5 AI Generation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/generate-text` | Generate text via selected AI model |
| POST | `/ai/improve-text` | Improve existing text |
| POST | `/fal-ai/images/generate` | Generate image via FAL.AI |
| POST | `/stories/generate-preview` | Generate Story preview image |
| POST | `/generate-content` | Legacy combined endpoint |

### 7.6 Keywords and Trends

| Method | Path | Description |
|--------|------|-------------|
| GET | `/keywords/:campaignId` | List keywords for campaign |
| POST | `/keywords` | Add keyword |
| DELETE | `/keywords/:id` | Remove keyword |
| POST | `/trends/collect` | Trigger n8n trend collection |
| GET | `/trends/global` | Get AI-generated global trends |

### 7.7 Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics` | Aggregated analytics across campaigns |
| POST | `/analytics/collect` | Trigger n8n analytics collection |
| POST | `/analytics/export/pdf` | Generate PDF report |
| POST | `/analytics/export/excel` | Generate Excel report |

### 7.8 Social Platform Validation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/validate/telegram` | Validate Telegram bot token |
| POST | `/validate/vk` | Validate VK API token |
| GET | `/youtube/auth` | Start YouTube OAuth flow |
| GET | `/instagram/oauth` | Instagram OAuth callback |

### 7.9 Media

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Upload image/video to Beget S3 |
| GET | `/media-proxy/:encodedUrl` | Proxy and optionally convert media |
| GET | `/media-proxy/:encodedUrl?story=1` | Convert to 9:16 story format |

### 7.10 System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check: Directus, S3, n8n |
| GET | `/admin/users` | List users (admin only) |
| GET | `/admin/api-keys` | List global API keys (admin only) |
| PATCH | `/admin/api-keys` | Update global API key (admin only) |

---

## 8. AI Integrations

### 8.1 Google Gemini

- **Models**: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash-exp`
- **Uses**: Text generation, trend analysis, website analysis, keyword extraction, sentiment analysis, speech-to-text (2.0 Flash), global trend discovery
- **Access**: Via Google AI SDK (`@google/generative-ai`) and Vertex AI
- **Key**: `GEMINI_API_KEY` or Vertex credentials

### 8.2 Anthropic Claude

- **Models**: `claude-3-5-sonnet-20241022`, `claude-3-haiku`
- **Uses**: Long-form content generation, business questionnaire filling, copywriting
- **Access**: Via `@anthropic-ai/sdk`
- **Key**: `CLAUDE_API_KEY`
- **Retry logic**: Exponential backoff on 429/529, `isAxiosError` detection

### 8.3 DeepSeek

- **Models**: `deepseek-chat`, `deepseek-coder`
- **Uses**: Website analysis (more detailed than Gemini for structured extraction), code generation
- **Access**: OpenAI-compatible API at `https://api.deepseek.com/v1`
- **Key**: `DEEPSEEK_API_KEY`

### 8.4 Qwen (Alibaba)

- **Models**: `qwen-plus`, `qwen-max`
- **Uses**: Multilingual content generation
- **Access**: Via HTTP API
- **Key**: `QWEN_API_KEY`

### 8.5 FAL.AI

- **Models**: Flux Pro, Flux Schnell, Stable Diffusion XL, LoRA custom models
- **Uses**: Image generation for posts, Stories backgrounds, carousel images
- **Access**: `@fal-ai/client`
- **Key**: `FAL_API_KEY`

### 8.6 AI Service Selection Logic

User selects model in the generation dialog. The server routes to the appropriate service class:

```
/api/ai/generate-text { model: "gemini-3.0-pro" }
  → GeminiService.generateContent()

/api/ai/generate-text { model: "deepseek" }
  → DeepSeekService.generateContent()

/api/ai/generate-text { model: "claude" }
  → ClaudeService.generateContent()
```

API keys are resolved from: **campaign-level keys** → **global admin keys** → **environment variables**.

---

## 9. Social Media Platform Integrations

### 9.1 Instagram

- **API**: Instagram Graph API (v18+)
- **Content types**: Single image posts, video Reels, Stories, Carousels
- **Auth**: OAuth 2.0 → stored access token in campaign api_keys
- **Publishing**: Handled by n8n workflow; server fires webhook
- **Media requirement**: Images must be hosted on public URL (Beget S3)

### 9.2 YouTube

- **API**: YouTube Data API v3
- **Content types**: Videos, Shorts
- **Auth**: OAuth 2.0 with offline access (refresh token stored)
- **Upload**: Resumable upload protocol
- **Metadata**: Title, description, tags, thumbnail, visibility

### 9.3 VK (VKontakte)

- **API**: VK API v5.131
- **Content types**: Wall posts (text + photos + videos), Clips (videos), Stories
- **Auth**: User access token with `wall`, `photos`, `video` scopes
- **VK Stories**: Published directly by server (not via n8n) — exception in the architecture
- **Clips/Posts**: Via n8n workflow

### 9.4 Telegram

- **API**: Telegram Bot API via Telegraf
- **Content types**: Text messages, photo captions, video messages, documents
- **Publishing**: Bot sends to configured channel/group
- **Token**: Bot token stored per-campaign; n8n handles actual send
- **Bot features**: See §4.10

### 9.5 TikTok

- **API**: TikTok Content Posting API
- **Auth**: OAuth 2.0 (PKCE flow)
- **Content types**: Videos
- **Upload modes**: `PULL_FROM_URL` (preferred), `FILE_UPLOAD`
- **Via**: n8n workflow

### 9.6 Facebook

- **API**: Facebook Graph API v18
- **Content types**: Page posts, Group posts (text + media)
- **Auth**: Page Access Token stored per-campaign
- **Webhooks**: `/api/webhooks/facebook` receives engagement events
- **Via**: n8n workflow

### 9.7 Threads

- **API**: Threads API (Instagram subsidiary)
- **Content types**: Text posts, single image posts
- **Auth**: Same credentials as Instagram
- **Publishing**: Direct via `threads-service.ts` (not n8n)

---

## 10. Authentication and Authorization

### 10.1 Token Lifecycle

```
Login → access_token (short-lived) + refresh_token (long-lived)
  ↓
Every 60s: background silent refresh
  ↓ (if 401 on any API call)
Attempt refresh with exponential backoff
  ↓ (if refresh fails permanently)
Clear tokens → redirect to /auth/login
```

### 10.2 Token Storage

- `localStorage` on web client (key: `directus_access_token`, `directus_refresh_token`)
- Shared between web and Telegram Mini App via same origin

### 10.3 Authorization Levels

| Role | Capabilities |
|------|-------------|
| `authenticated` | CRUD on own campaigns, content, keywords; own profile |
| `admin` | All above + user management + global API keys + system logs |

### 10.4 API Key Security

- Campaign API keys stored encrypted in Directus `api_keys` JSON field
- Global API keys accessible only to admin role
- Key resolution order: campaign → global → env var
- Keys never exposed in frontend responses; server reads them internally

---

## 11. Media Processing

### 11.1 Image Pipeline

1. User uploads or AI generates image
2. Server receives file → validates MIME type and size
3. Uploaded to **Beget S3** (`BEGET_S3_BUCKET`) with public-read ACL
4. Public URL returned and stored in content item `images[]` array
5. URL passed to n8n for social publishing

### 11.2 Story Image Conversion

- Endpoint: `GET /api/media-proxy/:encodedUrl?story=1`
- Input: Any image URL
- Processing via **Sharp**:
  - Resize to 1080×1920 (9:16)
  - Add blurred background fill from original image
  - Auto EXIF rotation correction
  - sRGB colorspace normalization
  - Output: JPEG, max 8MB

### 11.3 Video Processing

- FFmpeg used for:
  - Transcoding to platform-required formats (MP4 H.264)
  - Thumbnail extraction
  - Video compression for Reels/Shorts
  - VK Clips format conversion
- Temporary files stored in `/tmp/`, cleaned after processing

---

## 12. Scheduling and Publication Pipeline

### 12.1 Scheduler Service (`publish-scheduler.ts`)

- **Interval**: Runs every 30 seconds
- **Query**: Fetches all content with `status IN ('scheduled', 'pending', 'partial')`
- **Immediate publish**: Content with `scheduled_at = null` or `scheduled_at <= now()`
- **Trigger**: Also fires immediately when user clicks "Publish" button

### 12.2 Duplicate Prevention (6-Layer System)

| Layer | Mechanism |
|-------|----------|
| 1 | Status check: skip if not `scheduled`/`pending`/`partial` |
| 2 | Distributed lock per content ID (Redis or in-memory) |
| 3 | n8n idempotency key sent with each webhook call |
| 4 | n8n internal deduplication |
| 5 | Platform-level: check existing posts before creating |
| 6 | `social_platforms` field presence check (already published?) |

### 12.3 Publication Status

After n8n completes, it writes back to Directus:

```json
{
  "status": "published",
  "social_platforms": {
    "instagram": { "postId": "...", "status": "published", "postUrl": "..." }
  }
}
```

Frontend polls `GET /api/campaign-content/:id/status` until final state.

---

## 13. Analytics and Reporting

### 13.1 Data Collection

- N8N collects metrics from each platform's analytics API
- Stored in `analytics_data` Directus collection
- Triggered on-demand or by scheduler

### 13.2 Metrics Tracked

- Reach, impressions, engagement rate, likes, comments, shares
- Follower count change over time
- Link clicks, story views, video play rate

### 13.3 Sentiment Analysis

- Comments collected from all platforms
- Each comment classified: positive / neutral / negative (via Gemini)
- Sentiment score per post, per day aggregated

### 13.4 Report Export

**PDF Report**:
- Cover page with campaign logo/name
- Executive summary with key metrics
- Per-platform charts (generated server-side via Puppeteer/Canvas)
- Sentiment breakdown
- Multi-language output (RU / EN / ES)

**Excel Report**:
- Raw data per post per platform per day
- Summary pivot tables
- Generated via `xlsx` library

---

## 14. User Interface Requirements

### 14.1 Layout

- **Sidebar** navigation (collapsible on mobile) with icons + labels
- **Top bar**: Campaign selector, user menu, language switcher, theme toggle
- **Main content area**: responsive grid
- **Mobile breakpoints**: 320px, 768px, 1024px, 1280px

### 14.2 Sidebar Navigation Links

| Route | Label |
|-------|-------|
| `/dashboard` | Dashboard |
| `/campaigns` | Campaigns |
| `/content` | Content |
| `/publish/scheduled` | Scheduled |
| `/posts` | Publications |
| `/analytics` | Analytics |
| `/trends` | Trends |
| `/keywords` | Keywords |
| `/settings` | Settings |
| `/help/tutorials` | Help |
| `/pricing` | Pricing (public) |

### 14.3 Theme System

- Light and dark mode, toggled by user preference
- Persisted to `localStorage`
- CSS custom properties (HSL format) in `:root` and `.dark` classes
- Tailwind `darkMode: ["class"]`

### 14.4 Key UX Behaviors

- Loading skeletons during all async data fetches
- Toast notifications (success/error) for all user actions
- Optimistic UI updates where appropriate
- Dialog/modal for all create/edit forms
- Confirmation dialog before destructive actions

### 14.5 Data Test IDs

All interactive and meaningful elements carry `data-testid` attributes following pattern:
- Interactive: `{action}-{target}` (e.g., `button-create-content`, `input-campaign-name`)
- Lists: `{type}-{description}-{id}` (e.g., `card-content-abc123`)

---

## 15. Internationalization

- Library: `react-i18next`
- Supported languages: **Russian** (default), **English**, **Spanish**
- Language selector in top bar; persisted to `localStorage`
- Backend returns translated strings where applicable (AI generation, reports)
- Date/time formatting: locale-aware via `Intl.DateTimeFormat`
- All UI labels, error messages, and toast notifications translated

---

## 16. Security Requirements

### 16.1 Authentication Security

- Access tokens expire in 15 minutes (Directus default)
- Refresh tokens expire in 7 days
- HTTPS enforced in production (TLS via Nginx/Caddy)
- Tokens stored in `localStorage` (no `httpOnly` cookies — Telegram Mini App requirement)

### 16.2 API Security

- All `/api/*` routes (except `/auth/*` and `/health`) require valid Bearer token
- Admin routes additionally check `admin` role claim
- Rate limiting on auth endpoints (prevent brute force)
- CORS restricted to allowed origins in production

### 16.3 Media Security

- Media proxy validates URL against allowlist
- File type validation before upload (MIME sniffing)
- Max upload size: 100MB for video, 10MB for image
- Beget S3 bucket has strict ACL (public-read for media, private for other assets)

### 16.4 API Keys

- Third-party API keys never returned to frontend
- Stored encrypted at rest in Directus
- Admin-only endpoints for key management

---

## 17. Non-Functional Requirements

### 17.1 Performance

| Metric | Target |
|--------|--------|
| Page load time (LCP) | < 2.5s |
| API response time (p95) | < 2000ms |
| API success rate | ≥ 95% under 50 concurrent requests |
| Scheduler latency | < 30s from trigger to n8n call |
| Image upload | < 5s for images up to 10MB |

### 17.2 Availability

- Production uptime target: **99.5%** monthly
- Health check endpoint: `GET /api/health` monitors Directus, S3, n8n
- Auto-restart via Docker `restart: always`

### 17.3 Scalability

- Stateless Express server — horizontally scalable behind load balancer
- Directus handles database connection pooling
- n8n runs independently; server communicates only via webhooks
- Media stored on S3 (no local disk dependency in production)

### 17.4 Browser Support

- Chrome/Edge: last 2 major versions
- Firefox: last 2 major versions
- Safari: 16+
- Mobile: iOS Safari 16+, Chrome Android

---

## 18. Testing Requirements

### 18.1 Unit Tests

- Framework: **Vitest**
- Target: all server services in `/server/__tests__/`
- Coverage target: **90%** on service layer
- Current: **486 tests across 48 files** — all passing

Key tested services:
- `threads-service.ts` — Threads API integration
- `deepseek.ts` — DeepSeek AI service with retry logic
- `claude.ts` — Claude AI with `isAxiosError`-based retry
- All other AI services, publishing services, analytics services

### 18.2 End-to-End Tests

- Framework: **Playwright** (Chromium)
- Global auth state: `playwright/.auth/user.json` (set up by `auth.setup.ts`)
- Tests run against production: `https://smm.omemo.tech`
- Current passing: **114 tests**

Test files:
- `smm-flow.spec.ts` — full user flows (login, content, AI generation, profile)
- `navigation.spec.ts` — protected routes, 404 handling
- `keywords.spec.ts` — keyword management
- `full-audit.spec.ts` — stress-click bug hunter
- And 15+ other spec files

### 18.3 Stress Tests

- **API load test**: `tests/load/api-load.ts` — 50 concurrent requests per endpoint, p95 < 2s
- **Concurrent users**: `tests/stress-concurrent.spec.ts` — 5 parallel browser contexts
- **Rapid actions**: `tests/stress-rapid-actions.spec.ts` — rapid UI interactions, create/delete loops

Run API load test:
```bash
TEST_EMAIL=user@example.com TEST_PASSWORD=secret npx ts-node tests/load/api-load.ts
```

Run Playwright stress tests:
```bash
npx playwright test tests/stress-concurrent.spec.ts tests/stress-rapid-actions.spec.ts
```

---

## 19. Deployment Architecture

### 19.1 Production Stack

```
Internet
  ↓
Nginx (TLS termination, reverse proxy)
  ↓
Docker containers on VPS (omemo.tech)
  ├── smm        — Express + React (port 5000)
  ├── directus   — Headless CMS (port 8055)
  ├── n8n        — Workflow automation (port 5678)
  └── postgres   — PostgreSQL database (port 5432)
```

### 19.2 Environment Variables

| Variable | Description |
|----------|-------------|
| `DIRECTUS_URL` | Directus instance URL |
| `DIRECTUS_ADMIN_TOKEN` | Server-side admin token |
| `GEMINI_API_KEY` | Google Gemini API key |
| `CLAUDE_API_KEY` | Anthropic Claude API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `QWEN_API_KEY` | Qwen API key |
| `FAL_API_KEY` | FAL.AI API key |
| `BEGET_S3_BUCKET` | S3 bucket name |
| `BEGET_S3_ACCESS_KEY` | S3 access key |
| `BEGET_S3_SECRET_KEY` | S3 secret key |
| `N8N_URL` | n8n instance URL |
| `N8N_TRENDS_COLLECT_WEBHOOK` | n8n webhook URL |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `PORT` | Server port (default: 5000) |

### 19.3 Production Deploy Command

```bash
cd ~/smm && git pull && npm run build && cd .. && docker-compose restart smm
```

### 19.4 Development Environment

- Platform: **Replit**
- Dev server: `npm run dev` (Express + Vite, port 5000)
- N8N in dev: `https://n8n.roboflow.space` (vs `https://n8n.omemo.tech` in prod)
- Auth state: `.env` with `TEST_EMAIL`, `TEST_PASSWORD` for Playwright

---

## 20. External Dependencies

### 20.1 Core Infrastructure

| Service | Purpose | Provider |
|---------|---------|---------|
| Directus | CMS / Auth / Database ORM | Self-hosted (Docker) |
| PostgreSQL | Relational database | Self-hosted via Docker |
| n8n | Workflow automation / social publishing | Self-hosted (Docker) |
| Beget S3 | Object storage for media | Beget Cloud (ru1 region) |

### 20.2 AI Services

| Service | Models | Use Case |
|---------|--------|---------|
| Google Gemini | 2.5 Pro, 2.5 Flash, 2.0 Flash | Text + trends + speech |
| Anthropic Claude | claude-3-5-sonnet | Long-form content |
| DeepSeek | deepseek-chat | Website analysis |
| Alibaba Qwen | qwen-plus, qwen-max | Multilingual generation |
| FAL.AI | Flux, Schnell, SD-XL | Image generation |

### 20.3 Social APIs

| Platform | API | Auth Method |
|----------|-----|-------------|
| Instagram | Graph API v18 | OAuth 2.0 |
| YouTube | Data API v3 | OAuth 2.0 (offline) |
| VK | VK API v5.131 | User access token |
| Telegram | Bot API | Bot token |
| TikTok | Content Posting API | OAuth 2.0 (PKCE) |
| Facebook | Graph API v18 | Page access token |
| Threads | Threads API | OAuth 2.0 (via Instagram) |

### 20.4 NPM Package Highlights

| Package | Purpose |
|---------|---------|
| `@google/generative-ai` | Gemini SDK |
| `@anthropic-ai/sdk` | Claude SDK |
| `@fal-ai/client` | FAL.AI image generation |
| `telegraf` | Telegram Bot framework |
| `@tiptap/react` | Rich text editor |
| `sharp` | Server-side image processing |
| `ffmpeg-static` | Video processing |
| `@tanstack/react-query` | Data fetching & caching |
| `wouter` | Frontend routing |
| `recharts` / `@nivo/*` | Charts and analytics visualization |
| `xlsx` | Excel report generation |
| `drizzle-orm` | ORM (schema definition + zod) |
| `playwright` | E2E testing |
| `vitest` | Unit testing |

---

*Document maintained by the engineering team. Update this file when architectural decisions change, new platforms are added, or new AI models are integrated.*
