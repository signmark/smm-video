# SMM Manager

Платформа для управления социальными сетями: создание контента с помощью AI, планирование публикаций в Instagram, YouTube, Telegram, VK, Facebook и Threads.

## Run & Operate

- **Dev**: `npm run dev` (tsx server/index.ts, port 5000)
- **Build**: `npm run build` (vite build + esbuild bundle → dist/)
- **Start prod**: `npm run start` (node dist/server/index.js)
- **Frontend build**: `npx vite build` (only client → dist/public/)

Required env vars: все секреты уже настроены в Replit Secrets (DIRECTUS_URL, DIRECTUS_ADMIN_TOKEN, GEMINI_API_KEY, ANTHROPIC_API_KEY, BEGET_S3_*, DATABASE_URL и др.)

## Stack

- **Runtime**: Node.js 20, TypeScript (tsx for dev)
- **Frontend**: React 18, Vite 5, TailwindCSS, shadcn/ui, wouter, TanStack Query
- **Backend**: Express 4, Passport (local auth via Directus)
- **Database**: PostgreSQL (Replit DB via pg), Directus as headless CMS/auth
- **AI**: Anthropic Claude, Google Gemini/Vertex AI, OpenAI, DeepSeek, Qwen, FAL.AI
- **Storage**: Beget S3 (AWS SDK v3)
- **Other**: Telegraf (Telegram bot), googleapis (YouTube), fluent-ffmpeg

## Where things live

- `client/` — React frontend (Vite root)
- `server/` — Express backend entry: `server/index.ts`
- `server/routes.ts` — main API routes
- `server/services/` — AI, publishing, analytics services
- `server/telegram-bot/` — Telegram bot logic
- `shared/` — shared types
- `dist/public/` — built frontend (must run `npx vite build` before dev)

## Architecture decisions

- Dev mode serves the **production build** (dist/public) instead of Vite dev server — required for Telegram Mini App cache compatibility
- Auth via Directus (external): users authenticate through Directus API, sessions stored server-side
- API keys (AI, S3, etc.) fetched from Directus at runtime, overriding env vars — allows per-user key management
- Telegram bot webhook URL must match the public domain; 401 errors in dev are expected if bot token points to old server

## Product

- AI-powered content generation (text, images, stories) for multiple social networks
- Content calendar and scheduled publishing
- Multi-account social media management (Instagram OAuth, YouTube OAuth, etc.)
- Analytics dashboard, trend monitoring
- Telegram Mini App interface

## Video App (подпроект `video-app/`)

### Полный пайплайн генерации
1. AI пишет сценарий (N сцен с текстом, image-prompt, stockQuery)
2. **Stock precheck** — параллельно проверяет все сцены в Pexels; найденные → `videoSource=stock`, не найденные → `videoSource=ai`
3. Для AI-сцен автоматически генерируются **3 варианта картинок** (Imagen 4 / Gemini Flash) на выбор
4. Пользователь выбирает вариант для AI-сцен; сток-сцены уже готовы
5. Каждое изображение оживляется в видеоклип через FAL.AI (image-to-video)
6. TTS озвучивает текст каждой сцены (OpenAI → фолбэк HuggingFace)
7. ffmpeg склеивает клипы + аудио в MP4
8. Фоновая музыка (HuggingFace MusicGen) подмешивается в итоговое видео (громкость 0.18)

### Архитектура
- **Порт**: 3001 (отдельный Express-сервер)
- **Прокси**: основное приложение (порт 5000) форвардит `/video-app/*` → порт 3001, **с сохранением префикса `/video-app`**
- **Фронтенд**: Vite собирается с `base: '/video-app/'` — критично, иначе ассеты 404
- **Сервер раздаёт статику по двум путям**: `/video-app/*` (через прокси) и `/*` (прямой доступ на 3001)
- **БД**: PostgreSQL таблица `video_projects` (автосоздаётся при старте); фолбэк — JSON-файл если нет DATABASE_URL
- **Бинарные файлы**: `video-app/data/images/`, `video-app/data/videos/` — через volume в Docker
- **Workflow команда**: `cd video-app && npx vite build && npx tsx server/index.ts`

### Ключевые файлы
- `video-app/vite.config.ts` — `base: '/video-app/'` (не менять без понимания)
- `video-app/server/index.ts` — Express + статика по `/video-app` и `/`
- `video-app/server/db.ts` — PostgreSQL + JSON фолбэк, автосоздание таблицы; поля Scene: `videoSource`, `stockAvailable`, `stockQuery`; поле Script: `stockPrechecked`
- `video-app/server/routes.ts` — REST API `/api/videos`; содержит `runStockPrecheck()` и `runScriptOnly()`
- `video-app/server/services/fal-animator.ts` — FAL.AI image-to-video, параллельная анимация сцен
- `video-app/server/services/script-generator.ts` — Gemini сценарий
- `video-app/server/services/image-generator.ts` — Imagen 4 / Gemini Flash
- `video-app/server/services/tts-generator.ts` — OpenAI TTS (primary) + HuggingFace fallback (`facebook/mms-tts-rus`)
- `video-app/server/services/music-generator.ts` — HuggingFace MusicGen (`facebook/musicgen-small`)
- `video-app/server/services/video-assembler.ts` — ffmpeg сборка + `mixBackgroundMusic()`
- `video-app/server/services/stock-searcher.ts` — Pexels API поиск и скачивание клипов
- `video-app/client/src/pages/Create.tsx` — UI создания видео с выбором модели
- `video-app/client/src/pages/VideoDetail.tsx` — UI просмотра/редактирования сцен

### API endpoints (video-app)
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/videos` | список проектов |
| POST | `/api/videos` | создать проект |
| GET | `/api/videos/:id` | получить проект |
| DELETE | `/api/videos/:id` | удалить проект |
| POST | `/api/videos/:id/generate` | запустить генерацию |
| GET | `/api/videos/:id/download` | скачать MP4 |
| GET | `/api/videos/:id/audio/:sceneIndex` | превью TTS для сцены |
| GET | `/api/videos/:id/images/:sceneIndex/:variant` | картинка варианта (0-2, 3=кастом) |
| GET | `/api/videos/:id/clips/:sceneIndex` | стоковый клип сцены (MP4) |
| POST | `/api/videos/:id/scenes/:sceneIndex/generate-variants` | сгенерировать 3 варианта картинок |
| POST | `/api/videos/:id/scenes/:sceneIndex/stock-retry` | повторный поиск стока для сцены |
| PATCH | `/api/videos/:id/scenes/:sceneId` | обновить поля сцены (text, videoSource, selectedVariant и др.) |
| POST | `/api/videos/:id/scenes/:sceneIndex/upload-frame` | загрузить свой кадр (вариант 3) |

### Stock precheck (`runStockPrecheck`)
- Запускается **фоново** сразу после готовности сценария, не блокирует UI
- Ищет все сцены в Pexels параллельно (Promise.all)
- Найдено → скачивает клип в `data/images/{id}/clips/clip_{i}.mp4`, ставит `videoSource=stock`, `stockAvailable=true`
- Не найдено → `videoSource=ai`, `stockAvailable=false`, **автоматически генерирует 3 AI-варианта картинок**
- По завершении ставит `script.stockPrechecked=true`
- UI поллинг (каждые 3с) останавливается только когда `stockPrechecked=true` — обновляет кнопки AI/Stock автоматически без перезагрузки страницы

### TTS провайдеры (приоритет)
1. **OpenAI** (`tts-1`, voice=shimmer) — основной; при 429 → фолбэк
2. **HuggingFace** (`router.huggingface.co/hf-inference/models/facebook/mms-tts-rus`) — фолбэк; возвращает WAV, конвертируется в MP3 через ffmpeg
- Ключи: `HUGGINGFACE_API_KEY` (service_name в Directus: `HUGGINGFACE_API_KEY`)

### Фоновая музыка
- Генерируется через `router.huggingface.co/hf-inference/models/facebook/musicgen-small`
- Промпт строится автоматически по теме видео (`buildMusicPrompt`)
- Громкость музыки: 0.18 (голос преобладает)
- Если ключа нет или генерация упала — тихо пропускается, видео остаётся без музыки

### FAL.AI модели анимации (выбираются в UI)
| Значение | Модель FAL | Параметры |
|----------|-----------|-----------|
| `wan` | `fal-ai/wan/v2.7/image-to-video` | width/height, num_frames: 81 (не aspect_ratio/resolution!) |
| `wan-t2v` | `fal-ai/wan/v2.7/text-to-video` | width/height, num_frames: 81 |
| `kling` | `fal-ai/kling-video/v1.6/standard/image-to-video` | duration: 5s или 10s |
| `kling-pro` | `fal-ai/kling-video/v1.6/pro/image-to-video` | duration: 5s или 10s |
| `minimax` | `fal-ai/minimax/video-01-live/image-to-video` | prompt только |
| `seedance` | `fal-ai/bytedance/seedance-1-lite/image-to-video` | duration, aspect_ratio |

### Важные особенности и грабли
- **FAL polling**: использовать `status_url` и `response_url` из ответа submit — не конструировать URL вручную
- **Wan 2.7**: принимает `width`/`height` и `num_frames: 81` — НЕ `aspect_ratio`, НЕ `resolution`, НЕ `num_frames > 81`
- **Kling**: длительность только 5s или 10s (не произвольная); 30с видео = 3 сцены × 10s
- **Параллельность**: все сцены анимируются одновременно (Promise.all), не последовательно
- **FAL ключ**: загружается из Directus как `fal_ai` → маппится в `FAL_AI_API_KEY` в `load-keys.ts`
- **HuggingFace endpoint**: использовать `router.huggingface.co/hf-inference/models/...` — старый `api-inference.huggingface.co` устарел и возвращает 404
- **Directus 401 в dev**: ожидаемо — ключи загружаются только на проде
- **pg пакет**: должен быть в `video-app/package.json` — не полагаться на родительский node_modules
- **UI polling**: не останавливать на `script_ready` пока `stockPrechecked !== true` — иначе UI не увидит обновления от пречека

### Docker (прод)
- Пересборка: `docker-compose up -d --build video-app`
- DATABASE_URL пробрасывается как `postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres`
- Volume `./video_data:/app/video-app/data` — для изображений и видеофайлов

## User preferences

- User communicates in Russian
- Existing Directus auth should NOT be replaced with Replit Auth — it's the user's own external service
- **БЫТЬ ВНИМАТЕЛЬНЫМ во всей работе**: читать весь файл перед правками, проверять логику и арифметику, не вносить изменения не подумав о последствиях, не добавлять функции которые не вызываются, сверять сигнатуры функций после изменений
- **НЕ МЕТАТЬСЯ между решениями**: прежде чем менять подход — прочитать логи, понять причину ошибки, только потом менять. Не откатывать рабочее решение без чёткого понимания почему оно не работает
- **ЧИТАТЬ ЛОГИ ВНИМАТЕЛЬНО**: логи содержат всю нужную информацию — статусы ответов, конкретные ошибки. Не угадывать причину — читать что написано
- **campaigns GET /api/campaigns**: использует admin-токен (directusCrud + useAdminToken: true) + фильтр user_id=[_eq]=userId. Пользовательский токен тоже имеет доступ к своим кампаниям — 403 был временным следствием недоступности Directus-сервера (неоплаченный VPS), не проблемой прав

## Gotchas

- **Must build frontend before starting**: `npx vite build` → creates `dist/public/`. Without this, the app shows a loading spinner forever.
- Telegram bot token 401 in dev is expected — webhook URL points to production domain
- `npm run db:push` does not exist — ignore DB push steps
- Node 20 required; some AWS SDK warnings about Node 22 are non-critical

## Infrastructure

### Dev
- **App**: Replit (этот проект), порт 5000 (основной) + 3001 (Video App)
- **Directus**: https://directus.roboflow.space
- **N8N**: https://n8n.roboflow.space

### Prod
- **App**: smm.omemo.tech (внешний VPS)
- **Directus**: https://directus.nplanner.ru
- **N8N**: https://n8n.nplanner.ru

### Admin credentials (одинаковые для dev и prod Directus)
- **Email**: lbrspb@gmail.com
- **Password**: хранится в Replit Secrets как DIRECTUS_ADMIN_PASSWORD

### Как добавить глобальные ключи в Directus
Логин через email/пароль если нет статического токена:
```
POST /auth/login  { email, password } → access_token
POST /items/global_api_keys { service_name, api_key, is_active: true }
```
