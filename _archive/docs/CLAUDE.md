# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SMM Manager - платформа управления контентом в социальных сетях с AI-генерацией, аналитикой и мультиплатформенной публикацией. Full-stack приложение с React фронтендом и Express бэкендом.

## Commands

```bash
# Development
npm run dev          # Start dev server (tsx server/index.ts)
npm run dev:server   # Start with nodemon (hot reload)

# Production
npm run build        # Build frontend (Vite) + backend (esbuild)
npm start            # Run production build (NODE_ENV=production)

# Testing
npm test             # Run vitest
npm run test:jest    # Run Jest tests
npm run test:watch   # Jest in watch mode
npm run test:coverage # Jest with coverage
npm run test:ai      # AI-specific tests (autonomous-ai)
npm run test:integration # Integration tests
npm run test:e2e     # End-to-end tests

# Linting
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run check        # TypeScript type check
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Radix UI, TanStack Query, Wouter (routing), Zustand (state), i18next (localization)
- **Backend**: Express, TypeScript, tsx/esbuild
- **Database**: PostgreSQL via Directus SDK + Neon serverless
- **AI Services**: Claude (Anthropic), DeepSeek, Gemini (Google), FAL.AI (images), Perplexity, OpenAI
- **Storage**: Beget S3 (AWS SDK), Google Cloud Storage
- **Social Platforms**: Telegram (Telegraf), VK, Instagram, Facebook, YouTube, TikTok

## Architecture

```
├── client/src/           # React frontend
│   ├── App.tsx           # Main app with routing
│   ├── components/       # UI components (AIChat, Calendar, Forms, etc.)
│   ├── pages/            # Page components by feature
│   │   ├── admin/        # Admin panel pages
│   │   ├── campaigns/    # Campaign management
│   │   ├── content/      # Content editor pages
│   │   ├── analytics/    # Analytics dashboards
│   │   ├── stories/      # Stories editor
│   │   └── publish/      # Publishing interface
│   ├── hooks/            # React hooks
│   ├── lib/              # Utilities (queryClient, utils)
│   └── locales/          # i18n translations
│
├── server/               # Express backend
│   ├── index.ts          # Main server entry (~47KB, all routes)
│   ├── routes/           # Route handlers by feature
│   │   ├── campaigns.ts  # Campaign CRUD
│   │   ├── content.ts    # Content management
│   │   ├── analytics.ts  # Analytics endpoints
│   │   ├── ai.ts         # AI generation routes
│   │   └── *-settings.ts # Platform-specific settings
│   ├── services/         # Business logic
│   │   ├── ai-assistant.ts       # AI chat (180KB, main AI logic)
│   │   ├── autonomous-ai.ts      # Autonomous AI agent (120KB)
│   │   ├── social-publishing.ts  # Multi-platform publishing (124KB)
│   │   ├── directus-auth-manager.ts # Auth/token management
│   │   ├── beget-s3-*.ts         # S3 storage services
│   │   ├── claude.ts, deepseek.ts, falai.ts # AI integrations
│   │   └── social-platforms/     # Platform-specific services
│   │       ├── facebook-service.ts
│   │       ├── instagram-reels-service.ts
│   │       ├── vk-*.ts
│   │       └── youtube-service.ts
│   ├── middleware/       # Express middleware
│   ├── config/           # Configuration
│   └── database/         # DB utilities
│
├── shared/               # Shared code (client & server)
│   ├── schema.ts         # Zod schemas
│   ├── feature-flags.ts  # Feature toggles
│   └── stories-*.ts      # Stories-related shared code
│
├── docs/                 # Documentation
│   ├── api/              # API architecture docs
│   ├── ai/               # AI integration docs
│   ├── social_media/     # Social media integration docs
│   ├── deployment/       # Deployment guides
│   └── testing/          # Testing docs
│
└── test_scripts/         # Test scripts by platform
    ├── telegram/
    ├── instagram/
    ├── facebook/
    ├── beget_s3/
    └── fal_ai/
```

## Key Patterns

### API Routes
- All routes defined in `server/index.ts` and `server/routes/*.ts`
- Directus SDK used for database operations (`server/directus.ts`)
- Auth via custom token refresh middleware (`server/services/directus-auth-manager.ts`)

### State Management
- TanStack Query for server state
- Zustand for client state
- React Query cache invalidation patterns

### AI Integration
- Multiple AI providers with fallback logic
- Streaming responses supported
- AI chat history stored in Directus

### Social Publishing
- Unified publishing interface in `social-publishing.ts`
- Platform-specific services in `services/social-platforms/`
- Support for: posts, stories, reels, clips, shorts

### File Storage
- Primary: Beget S3 (AWS SDK compatible)
- Image processing via Sharp
- Video processing via fluent-ffmpeg

## Environment Variables

Key variables needed (see `.env.sample` for full list):

```bash
# Database
DATABASE_URL=postgres://...
DIRECTUS_URL=https://...
DIRECTUS_ADMIN_TOKEN=...

# AI Services
ANTHROPIC_API_KEY=...
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
FAL_AI_API_KEY=...
PERPLEXITY_API_KEY=...
OPENAI_API_KEY=...

# Storage
BEGET_S3_ACCESS_KEY=...
BEGET_S3_SECRET_KEY=...
BEGET_S3_BUCKET=...
BEGET_S3_ENDPOINT=...

# Social Platforms
TELEGRAM_BOT_TOKEN=...
VK_TOKEN=...
INSTAGRAM_ACCESS_TOKEN=...
FACEBOOK_ACCESS_TOKEN=...
YOUTUBE_API_KEY=...
```

## Testing

```bash
# Run specific test file
npm run test:jest -- path/to/test.ts

# Run tests matching pattern
npm run test:jest -- --testNamePattern="pattern"

# Platform-specific tests
cd test_scripts && ./run-tests.sh
```

## Common Tasks

### Adding new AI provider
1. Create service in `server/services/`
2. Add routes in `server/routes/ai.ts` or new route file
3. Register in `server/index.ts`

### Adding new social platform
1. Create service in `server/services/social-platforms/`
2. Add to `social-publishing.ts` publishing logic
3. Create campaign settings route in `server/routes/campaign-*-settings.ts`
4. Add frontend settings component

### Database migrations
- Directus handles schema via admin panel
- SQL scripts in root for manual migrations

## Important Notes

- Node.js 20+ required (see `.nvmrc`, `.node-version`)
- TypeScript strict mode enabled
- ESM modules (`"type": "module"` in package.json)
- Frontend port: 5000 (Vite proxy to backend)
- Production URL: https://smm.omemo.tech
