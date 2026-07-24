import './load-env';
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from 'swagger-ui-express';
import swaggerSpecs from './config/swagger';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer, request as httpRequest } from 'http';
import { WebSocketServer } from 'ws';
import { broadcastNotification, setNotificationBroadcaster } from './services/notification-bus';
import { registerRoutes } from "./routes";
import { registerFalAiImageRoutes } from "./routes-fal-ai-images";
import { registerClaudeRoutes } from "./routes-claude";
import { registerDeepSeekRoutes } from "./routes-deepseek";
import { registerDeepSeekModelsRoute } from "./routes-deepseek-models";
import { registerQwenRoutes } from "./routes-qwen";
import { registerGeminiRoutes } from "./routes-gemini";
import { registerBegetS3Routes } from "./routes-beget-s3";
import { registerUserApiKeysRoutes } from "./routes-user-api-keys";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerTelegramChannelsRoutes } from "./routes/telegram-channels-routes";
import supportRoutes from "./routes/support-routes";
import autonomousRouter from "./routes/autonomous";
import { restoreAutonomousStates, getActiveAutonomousCampaignIds } from './services/autonomous-ai';
// daily-trend-scheduler импорт удалён — планировщик отключён, сбор трендов только вручную
import { log, logEnvironmentInfo } from "./utils/logger";
import { directusApiManager } from './directus';
import { registerXmlRiverRoutes } from './api/xmlriver-routes';
import { falAiUniversalService } from './services/fal-ai-universal';
import { initializeHeavyServices } from './optimize-startup';
// Импортируем тестовые маршруты для Telegram
import testRouter from './api/test-routes';
// Импортируем маршруты для диагностики и исправления URL в Telegram
import telegramDiagnosticsRouter from './api/test-routes-last-telegram';
// Импортируем API аналитики
import analyticsRouter from './analytics-api';
// Импортируем маршруты для видео
import videoRouter from './routes/video.js';
// Импортируем валидатор статусов публикаций
import { statusValidator } from './services/status-validator';
// Импортируем исправленный планировщик публикаций
import { getPublishScheduler } from './services/publish-scheduler';
// Импортируем Telegram бота
import { startTelegramBot, getWebhookCallback } from './telegram-bot/bot-launcher';
import { loadEnvFromDirectus } from './services/load-env-from-directus';

import ffmpeg from 'fluent-ffmpeg';

const DEFAULT_FFMPEG_PATH = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const DEFAULT_FFPROBE_PATH = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';

async function resolveInstallerPath(moduleName: string, fallbackPath: string, label: string) {
  try {
    const installerModule = await import(moduleName);
    const resolvedPath = installerModule?.default?.path || installerModule?.path;
    if (typeof resolvedPath === 'string' && resolvedPath.length > 0) {
      console.log("[FFmpeg] " + label + " path resolved using " + moduleName + ": " + resolvedPath);
      return resolvedPath;
    }
    console.warn("[FFmpeg] " + label + " module " + moduleName + " did not expose a path, falling back to " + fallbackPath);
  } catch (error) {
    console.warn("[FFmpeg] Failed to load " + moduleName + ", falling back to " + fallbackPath);
  }
  return fallbackPath;
}

const ffmpegPath = await resolveInstallerPath('@ffmpeg-installer/ffmpeg', DEFAULT_FFMPEG_PATH, 'ffmpeg');
const ffprobePath = await resolveInstallerPath('@ffprobe-installer/ffprobe', DEFAULT_FFPROBE_PATH, 'ffprobe');

// Глобальная инициализация FFmpeg путей
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Загружаем API-ключи из Directus в process.env (до инициализации сервисов)
await loadEnvFromDirectus();

// Import additional route handlers
import adminUsersRoutes from './routes/admin-users';
import promoCodesRouter from './routes/promo-codes';
import begetS3Routes from './routes/beget-s3-aws';
import realVideoConverterRoutes from './routes/real-video-converter';
import webCrawlerRoutes from './routes/web-crawler-routes';
import subscriptionsRouter from './routes/subscriptions';
import yookassaRouter from './routes/yookassa';

// NODE_ENV должен определяться системой (development или production)

// Глобальная переменная для доступа к directusApiManager без импорта (избегаем циклические зависимости)
// @ts-expect-error - игнорируем проверку типов
global['directusApiManager'] = directusApiManager;

import clipsPublishingRouter from './api/clips-publishing-router';
import { forceUpdateStatusRouter } from './api/force-update-status';

import videoProcessingRoutes from './routes/videoProcessing';

const app = express();
app.set('etag', false);
// За обратным прокси (nginx в проде / прокси Replit в dev) — иначе rate-limit видит IP прокси,
// а не клиента. 1 = доверяем одному ближайшему прокси.
app.set('trust proxy', 1);

// === Universal public OAuth callback bypass (security plan §N — fix 2026-07-24) ===
// Внешние провайдеры (Google / VK / Instagram / Threads / TikTok) редиректят
// пользователя обратно на /api/*/auth/callback БЕЗ Bearer-токена нашего приложения.
// Также needanapp.ru (прокси для VK) стучит по /api/vk/callback для отправки токенов.
//
// Эти пути публичные by design — handler валидирует state против серверного
// хранилища (см. youtube-auth.ts:122, instagram-oauth.ts, threads-oauth.ts и т.д.).
//
// Чтобы обойти ЛЮБОЙ глобальный `app.use('/api', authMiddleware)` (в т.ч. чужой,
// добавленный в Mimo'вой security-hardening сборке) — мы монтируем handler'ы
// НАПРЯМУЮ через app.get В САМОМ НАЧАЛЕ, до всех остальных middleware.
// Express применяет обработчики в порядке регистрации, и app.get, зарегистрированный
// раньше app.use('/api', X), сработает первым — X не получит шанса отбить запрос 401.
// Не удалять без апдейта security-плана.
import youtubeAuthRouter from './routes/youtube-auth';
import vkOAuthRouter from './routes/vk-oauth';
import instagramOAuthRouter from './routes/instagram-oauth';
import threadsOAuthRouter from './routes/threads-oauth';
import tiktokAuthRouter from './routes/tiktok-auth';

const PUBLIC_OAUTH_CALLBACKS = [
  { router: youtubeAuthRouter, routerPath: '/youtube/auth/callback', publicPath: '/api/youtube/auth/callback' },
  { router: vkOAuthRouter, routerPath: '/vk/oauth2/callback', publicPath: '/api/vk/oauth2/callback' },
  { router: vkOAuthRouter, routerPath: '/vk/callback', publicPath: '/api/vk/callback' },
  { router: instagramOAuthRouter, routerPath: '/instagram/auth/callback', publicPath: '/api/instagram/auth/callback' },
  { router: threadsOAuthRouter, routerPath: '/threads/auth/callback', publicPath: '/api/threads/auth/callback' },
  { router: tiktokAuthRouter, routerPath: '/tiktok/auth/callback', publicPath: '/api/tiktok/auth/callback' },
];

for (const { router, routerPath, publicPath } of PUBLIC_OAUTH_CALLBACKS) {
  // Найти внутренний handler в router'е по path
  const layer = (router as any).stack.find(
    (l: any) => l.route && l.route.path === routerPath
  );
  if (!layer) {
    console.warn(`[oauth-bypass] ⚠️ Не найден handler для ${publicPath} в роутере — пропускаю`);
    continue;
  }
  const innerHandler = layer.route.stack[0].handle;
  app.get(publicPath, innerHandler);
  console.log(`[oauth-bypass] ✅ ${publicPath} → смонтирован до всех middleware`);
}

// Security-заголовки. CSP/frameguard/CORP отключены намеренно: приложение работает
// как Telegram Mini App внутри iframe (web.telegram.org) и грузит ассеты с S3.
// Остаются полезные дефолты helmet: nosniff, HSTS, referrer-policy, X-DNS-Prefetch и т.д.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false,
}));

const server = createServer(app);

// Тестовые endpoints удалены для исправления перехвата API

// WebSocket server для real-time уведомлений (noServer=true чтобы не перехватывать Vite HMR)
const wss = new WebSocketServer({ noServer: true });

// Обработка WebSocket подключений
wss.on('connection', (ws) => {
  log('WebSocket клиент подключен', 'websocket');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      log(`WebSocket сообщение получено: ${data.type}`, 'websocket');
    } catch (error) {
      log(`Ошибка парсинга WebSocket сообщения: ${error}`, 'websocket');
    }
  });

  ws.on('close', () => {
    log('WebSocket клиент отключен', 'websocket');
  });
});

// Вручную обрабатываем upgrade — только /ws идёт в наш WSS, остальное (Vite HMR) пропускается
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '/', `http://${request.headers.host}`);
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
  // Все остальные пути (например /__vite_hmr) обрабатываются Vite
});

// Функция для отправки уведомлений всем подключенным клиентам
setNotificationBroadcaster((type: string, data: unknown) => {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
});

export { broadcastNotification };

// Экспортируем WebSocket server для использования в других модулях
export { wss };

// Увеличиваем лимиты для обработки изображений Stories
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
  next();
});
const corsOrigin = process.env.NODE_ENV === 'production'
  ? ['https://smm.omemo.tech', 'https://t.me', 'https://vk.needanapp.ru', 'https://needanapp.ru']
  : true;

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());

// --- Rate limiting ---
// Строгий лимит на чувствительные операции (брутфорс логина/регистрации, абуз создания платежей).
// ВАЖНО: вешаем точечно, НЕ на весь /api/auth — /api/auth/me, /check, /refresh поллит фронт.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Слишком много попыток. Повторите позже.' },
});
// Мягкий глобальный флуд-гард: ловит только настоящий поток запросов, не мешает поллингу UI.
// Вебхуки (платёжка, соцсети) пропускаем — они верифицируются отдельно и приходят от провайдеров.
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.includes('/webhook'),
  message: { success: false, error: 'Слишком много запросов. Повторите позже.' },
});

app.use('/api/auth/login', sensitiveLimiter);
app.use('/api/auth/register', sensitiveLimiter);
app.use('/api/auth/password-reset', sensitiveLimiter);
app.use('/api/payments/create', sensitiveLimiter);
app.use('/api', globalApiLimiter);

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Гейт подписки: истёкшим пользователям запрещены любые изменяющие операции
// (создание/генерация/публикация/правка/удаление), но чтение своих данных
// кампаний (GET) остаётся доступным — чтобы сохранить наработки или мигрировать.
import { requireActiveSubscription } from './middleware/require-active-subscription';
app.use(requireActiveSubscription);

// Health check endpoint for deployment monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Trends Collection API (регистрируем максимально рано для избежания 404)
import { registerTrendsRoutes } from './api/trends-routes';

// Регистрируем маршруты аутентификации ПЕРЕД всем остальным
import { registerAuthRoutes } from './api/auth-routes';
registerAuthRoutes(app);
import { registerPasswordResetRoutes } from './api/password-reset';
registerPasswordResetRoutes(app);
log('Auth routes registered early to avoid 404');

// Регистрация Trends Routes максимально рано
log("Registering Trends routes early...");
registerTrendsRoutes(app);

// Регистрация Analytics Routes максимально рано
log("Registering Analytics routes early...");
registerAnalyticsRoutes(app);


// Добавляем API маршруты для проверки статуса и проверки админа явно, чтобы они работали до инициализации Vite
app.get('/api/status-check', (req, res) => {
  return res.json({ status: 'ok', server: 'running', time: new Date().toISOString() });
});

// Feature Flags (Критично для фронтенда)
import { featureFlagsRouter } from './routes/feature-flags';
app.use('/api', featureFlagsRouter);

// Регистрируем прямые маршруты аутентификации до инициализации Vite
import { registerSimpleAnalyticsAPI } from './simple-analytics-api';

// Регистрируем прямой API аналитики ПЕРЕД всеми остальными маршрутами
registerSimpleAnalyticsAPI(app);

// Удалено: registerAuthRoutes(app) перенесен выше
// registerAuthRoutes(app);

// Регистрируем маршруты для клипов иshorts
app.use('/api', clipsPublishingRouter);
app.use('/api', forceUpdateStatusRouter);

// Регистрируем маршруты социальной публикации (включая /api/publish/now)
import socialPublishingRouter from './api/social-publishing-router';
app.use('/api', socialPublishingRouter);
log('Social publishing routes registered (including /api/publish/now)');

// Импортируем и регистрируем маршруты для глобальных API ключей
import { registerGlobalApiKeysRoutes } from './routes-global-api-keys';
// Импортируем Instagram Setup Wizard
import instagramSetupRoutes from './routes/instagram-setup-wizard';
// Импортируем Facebook Pages router
import facebookPagesRouter from './routes/facebook-pages';
// Импортируем Facebook Debug router
import facebookDebugRouter from './routes/facebook-debug';
// Импортируем Facebook Page URL router
import facebookPageUrlRouter from './routes/facebook-page-url';
// Импортируем Facebook Groups Discovery router
import facebookGroupsRouter from './routes/facebook-groups-discovery';
registerGlobalApiKeysRoutes(app);
log('Global API keys routes registered early to avoid Vite middleware interception');

// Регистрируем маршруты для пользовательских API ключей раньше Vite
registerUserApiKeysRoutes(app);
log('User API keys routes registered early to avoid Vite middleware interception');

// Регистрируем Instagram Setup Wizard маршруты
app.use('/api/instagram-setup', instagramSetupRoutes);
log('Instagram Setup Wizard routes registered');

// Регистрируем Facebook Pages маршруты
app.use('/api/facebook', facebookPagesRouter);
log('Facebook Pages routes registered');

// Регистрируем Facebook Debug маршруты
app.use('/api/facebook', facebookDebugRouter);
log('Facebook Debug routes registered');

// Регистрируем Facebook Page URL маршруты
app.use('/api/facebook', facebookPageUrlRouter);
log('Facebook Page URL routes registered');

// Регистрируем Facebook Groups Discovery маршруты
app.use('/api', facebookGroupsRouter);
log('Facebook Groups Discovery routes registered');

// Регистрируем Directus Proxy routes (Backend API Gateway)
import { proxyRouter } from './api/proxy-routes';
app.use('/api/proxy', proxyRouter);
log('Directus Proxy routes registered (Backend API Gateway)');

// Регистрируем YouTube Auth маршруты раньше всех
import youtubeAuthRouter from './routes/youtube-auth';
import youtubeSettingsRouter from './routes/campaign-youtube-settings';
app.use('/api', youtubeAuthRouter);
app.use('/api', youtubeSettingsRouter);
log('YouTube Auth and Settings routes registered early to avoid 404 errors');


// Регистрируем маршрут загрузки изображений раньше Vite
import multer from 'multer';
import { BegetS3StorageAws } from './services/beget-s3-storage-aws';
import { authMiddleware } from './middleware/auth';

const uploadMiddleware = multer({ storage: multer.memoryStorage() });

app.post('/api/s3/upload-image', authMiddleware, uploadMiddleware.single('image'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      console.error('[s3-upload-file] Файл не получен');
      return res.status(400).json({ success: false, error: 'Отсутствует файл изображения' });
    }

    console.log('[s3-upload-file] Получен файл:', file.originalname, 'размер:', file.size);

    const s3Storage = new BegetS3StorageAws();
    const filename = `stories/story-${Date.now()}-${file.originalname}`;
    const contentType = file.mimetype || 'image/jpeg';

    const result = await s3Storage.uploadFile({
      key: filename,
      fileData: file.buffer,
      contentType: contentType
    });

    if (!result.success || !result.url) {
      throw new Error(result.error || 'Ошибка загрузки в S3');
    }

    console.log('[s3-upload-file] Загружено на Beget S3:', result.url);
    return res.json({
      success: true,
      data: {
        url: result.url,
        display_url: result.url,
        link: result.url
      }
    });
  } catch (error: any) {
    console.error('[s3-upload-file] Ошибка загрузки:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});
log('Image upload route registered early');

// Instagram Campaign Settings маршруты будут зарегистрированы ПОСЛЕ registerRoutes
// чтобы иметь приоритет над конфликтующими маршрутами в routes.ts
log('Instagram Campaign Settings routes will be registered after main routes');

// Маршрут /api/auth/is-admin регистрируется в registerAuthRoutes (api/auth-routes.ts).
// Дубликат, который раньше был здесь, никогда не достигался — Express берёт первый совпавший.

// robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(
`User-agent: *
Allow: /
Allow: /pricing
Disallow: /api/
Disallow: /admin/
Disallow: /test/
Disallow: /auth/

Sitemap: https://smm.omemo.tech/sitemap.xml`
  );
});

// sitemap.xml
app.get('/sitemap.xml', (req, res) => {
  const base = 'https://smm.omemo.tech';
  const now = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/pricing', priority: '0.9', changefreq: 'monthly' },
    { loc: '/auth/login', priority: '0.7', changefreq: 'monthly' },
    { loc: '/auth/register', priority: '0.8', changefreq: 'monthly' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${base}${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  res.type('application/xml');
  res.send(xml);
});

// Статические файлы для лендингов (должно быть ДО маршрута)
app.use('/landing', express.static('smmniap_static'));
app.use('/smmniap_static', express.static('smmniap_static'));
app.use('/alisa', express.static('alisa_static'));
app.use('/alisa_static', express.static('alisa_static'));

// Маршрут для лендинга
app.get('/landing', (req, res) => {
  res.sendFile(process.cwd() + '/smmniap_static/index.html');
});

// Маршрут для smmniap_static
app.get('/smmniap_static', (req, res) => {
  res.sendFile(process.cwd() + '/smmniap_static/index.html');
});

// Маршрут для ALISA
app.get('/alisa', (req, res) => {
  res.sendFile(process.cwd() + '/alisa_static/index.html');
});

app.get('/alisa_static', (req, res) => {
  res.sendFile(process.cwd() + '/alisa_static/index.html');
});

// Специальный маршрут для проверки доступности сервера с интерфейсом
app.get('/server-health', (req, res) => {
  const content = `
  <!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Сервер работает</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
      .status { color: #4caf50; font-weight: bold; }
      .time { color: #2196f3; margin-top: 20px; }
      pre { text-align: left; max-width: 800px; margin: 20px auto; background: #f5f5f5; padding: 15px; border-radius: 5px; }
    </style>
  </head>
  <body>
    <h1>Статус сервера: <span class="status">Работает</span></h1>
    <div class="time">Текущее время: ${new Date().toLocaleString('ru-RU')}</div>
    <pre>
API маршруты:
- GET /api/status-check - Проверка статуса API
- GET /api/claude/test-api-key - Проверка API ключа Claude
- POST /api/claude/improve-text - Улучшение текста с Claude AI

Конфигурация сервера:
- NODE_ENV: ${process.env.NODE_ENV || 'не задано'}
- PORT: ${process.env.PORT || '5000 (по умолчанию)'}
    </pre>
  </body>
  </html>
  `;
  return res.status(200).type('html').send(content);
});

// Middleware для логирования запросов
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Middleware для извлечения userId из заголовка и сохранения в req.userId
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'] as string;
  if (userId) {
    (req as any).userId = userId;
  }
  next();
});

// Регистрация роутов для видео обработки
app.use('/api/video-processing', videoProcessingRoutes);

// Прокси для Video Generator UI (порт 3001 → /video-app на основном домене)
// Vite собран с base='/video-app/', поэтому форвардим с префиксом /video-app
app.use('/video-app', (req, res, next) => {
  console.log(`[VIDEO-PROXY] Hit: ${req.method} /video-app${req.url}`);
  const forwardPath = '/video-app' + (req.url || '/');

  // express.json() уже прочитал тело — пересобираем его вручную
  const bodyStr = req.body && Object.keys(req.body).length > 0
    ? JSON.stringify(req.body)
    : undefined;

  // Убираем заголовки, которые могут вызвать несоответствие при проксировании
  const { 'content-length': _cl, 'transfer-encoding': _te, ...restHeaders } = req.headers as any;
  const videoAppHost = process.env.VIDEO_APP_HOST || 'localhost';
  const headers: Record<string, string | string[]> = { ...restHeaders, host: `${videoAppHost}:3001` };
  if (bodyStr) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(bodyStr).toString();
  }

  const options = {
    hostname: process.env.VIDEO_APP_HOST || 'localhost',
    port: 3001,
    path: forwardPath,
    method: req.method,
    headers,
  };
  const proxy = httpRequest(options, (proxyRes: any) => {
    console.log(`[VIDEO-PROXY] Response from 3001: ${proxyRes.statusCode} for ${forwardPath}`);
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on('error', (err: any) => {
    console.error(`[VIDEO-PROXY] Error: ${err.message}`);
    res.status(502).send('Video App недоступен');
  });
  if (bodyStr) {
    proxy.write(bodyStr);
    proxy.end();
  } else {
    req.pipe(proxy, { end: true });
  }
});

(async () => {
  try {
    console.log("=== SERVER INITIALIZATION START ===");
    console.log('Бэкенд использует статический токен для Directus');
    log("Starting server initialization...");

    // КРИТИЧНО: Загружаем сессии из БД при старте, чтобы работал авто-рефреш токенов
    try {
      const { directusAuthManager } = await import('./services/directus-auth-manager');
      await directusAuthManager.loadSessionsFromDB();
      log("Sessions loaded from database successfully");
    } catch (e) {
      console.warn("Failed to load sessions from database:", e);
    }

    // Регистрируем видео роуты
    app.use('/api/video', videoRouter);
    log("Video processing routes registered");

    // Регистрируем webhook для Telegram бота
    app.post('/telegram-webhook', express.json(), async (req, res) => {
      console.log('📥 [telegram-webhook] Получен запрос от Telegram');
      const body = req.body;
      const updateType = body ? Object.keys(body).filter(k => k !== 'update_id').join(',') : 'unknown';
      const cbData = body?.callback_query?.data ?? null;
      console.log(`📥 [telegram-webhook] update_id=${body?.update_id} type=${updateType}${cbData ? ` cb_data="${cbData}"` : ''}`);
      const webhookCallback = getWebhookCallback();
      if (webhookCallback) {
        console.log('✅ [telegram-webhook] Webhook callback готов, обрабатываем запрос');
        try {
          await webhookCallback(req, res);
          console.log('✅ [telegram-webhook] Запрос успешно обработан');
        } catch (error) {
          console.error('❌ [telegram-webhook] Ошибка обработки:', error instanceof Error ? error.message : error);
          if (!res.headersSent) {
            res.status(500).send('Internal error processing webhook');
          }
        }
      } else {
        console.warn('⚠️ [telegram-webhook] Бот ещё не готов, пожалуйста подождите...');
        console.warn('⚠️ [telegram-webhook] Callback = null, возможно бот ещё инициализируется');
        res.status(503).send('Telegram bot is starting, please wait...');
      }
    });
    log("Telegram webhook endpoint registered");

    // Тестовые маршруты — только в dev-окружении
    if (process.env.NODE_ENV !== 'production') {
      log("Registering test API routes (dev only)...");
      app.use('/api/test', testRouter);
      app.use('/api/telegram-diagnostics', telegramDiagnosticsRouter);
      try {
        const instagramVideoTestRoutes = (await import('./routes/instagram-video-test')).default;
        app.use('/api/test', instagramVideoTestRoutes);
      } catch (err) {
        log(`instagram-video-test routes skipped: ${err instanceof Error ? err.message : err}`);
      }
      log("Test API routes registered");
    }

    // Прокси для Instagram видео (решение проблемы S3)
    try {
      const instagramVideoProxyRoutes = (await import('./routes/instagram-video-proxy')).default;
      app.use('/api', instagramVideoProxyRoutes);
    } catch (err) {
      log(`instagram-video-proxy routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    log("Registering Claude AI routes...");
    registerClaudeRoutes(app);
    log("Claude AI routes registered");

    log("Registering DeepSeek routes...");
    registerDeepSeekRoutes(app);
    log("DeepSeek routes registered");

    log("Registering Qwen routes...");
    registerQwenRoutes(app);
    log("Qwen routes registered");

    log("Registering Gemini routes...");
    registerGeminiRoutes(app);
    log("Gemini routes registered");

    log("Registering YouTube Channel routes...");
    try {
      const youtubeChannelRouter = (await import('./routes/youtube-channel')).default;
      app.use('/api', youtubeChannelRouter);
      log("YouTube Channel routes registered");
    } catch (err) {
      log(`youtube-channel routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    log("Registering main routes...");
    await registerRoutes(app);

    // Swagger API Documentation - добавляем после всех маршрутов
    // В продакшн используем pre-generated swagger.json (исходники TS недоступны в контейнере)
    const __dirname_sw = dirname(fileURLToPath(import.meta.url));
    const prebuiltSwaggerPath = resolve(__dirname_sw, '../public/swagger.json');
    const activeSpecs = (process.env.NODE_ENV === 'production' && existsSync(prebuiltSwaggerPath))
      ? JSON.parse(readFileSync(prebuiltSwaggerPath, 'utf-8'))
      : swaggerSpecs;

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(activeSpecs, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'SMM Manager API Documentation',
      customfavIcon: '/favicon.ico',
      swaggerOptions: {
        persistAuthorization: true,
        displayOperationId: false,
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
      }
    }));

    // JSON endpoint для Swagger spec
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(activeSpecs);
    });

    log('Swagger API Documentation доступна по адресу /api-docs', 'swagger');

    // Регистрируем Instagram Campaign Settings маршруты ПОСЛЕ registerRoutes
    // чтобы они имели приоритет над конфликтующими маршрутами в routes.ts
    log("Registering Instagram Campaign Settings routes...");
    try {
      const campaignInstagramRoutes = (await import('./routes/campaign-instagram-settings')).default;
      app.use('/api', campaignInstagramRoutes);
      log('Instagram Campaign Settings routes registered with priority');
    } catch (err) {
      log(`campaign-instagram-settings routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    log("Registering Instagram OAuth routes...");
    try {
      const instagramOAuthRouter = (await import('./routes/instagram-oauth')).default;
      app.use('/api', instagramOAuthRouter);
      log("Instagram OAuth routes registered");
    } catch (err) {
      log(`instagram-oauth routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    log("Registering Threads OAuth routes...");
    try {
      const threadsOAuthRouter = (await import('./routes/threads-oauth')).default;
      app.use('/api', threadsOAuthRouter);
      log("Threads OAuth routes registered");
    } catch (err) {
      log(`threads-oauth routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const threadsSettingsRouter = (await import('./routes/campaign-threads-settings')).default;
      app.use('/api', threadsSettingsRouter);
      log("Threads Campaign Settings routes registered");
    } catch (err) {
      log(`campaign-threads-settings routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    log("Registering VK OAuth routes...");
    try {
      const vkOAuthRouter = (await import('./routes/vk-oauth')).default;
      app.use('/api', vkOAuthRouter);
      log("VK OAuth routes registered");
    } catch (err) {
      log(`vk-oauth routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const vkSettingsRouter = (await import('./routes/campaign-vk-settings')).default;
      app.use('/api', vkSettingsRouter);
      log("VK Campaign Settings routes registered");
    } catch (err) {
      log(`campaign-vk-settings routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const facebookSettingsRouter = (await import('./routes/campaign-facebook-settings')).default;
      app.use('/api', facebookSettingsRouter);
      log("Facebook Campaign Settings routes registered");
    } catch (err) {
      log(`campaign-facebook-settings routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const campaignSettingsRouter = (await import('./routes/campaign-settings')).default;
      app.use('/api', campaignSettingsRouter);
      log("Campaign Settings routes registered");
    } catch (err) {
      log(`campaign-settings routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const unpublishContentRouter = (await import('./routes/unpublish-content')).default;
      app.use('/api', unpublishContentRouter);
      log("Unpublish Content routes registered");
    } catch (err) {
      log(`unpublish-content routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const deleteContentRouter = (await import('./routes/delete-content')).default;
      app.use('/api', deleteContentRouter);
      log("Delete Content routes registered");
    } catch (err) {
      log(`delete-content routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const storiesRoutes = (await import('./routes/stories')).default;
      app.use('/api/stories', storiesRoutes);
      log("Stories routes registered");
    } catch (err) {
      log(`stories routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    try {
      const storiesImageGenerator = (await import('./routes/stories-image-generator')).default;
      app.use('/api/stories', storiesImageGenerator);
      log("Stories Image Generator routes registered");
    } catch (err) {
      log(`stories-image-generator routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    registerTelegramChannelsRoutes(app);
    log("Telegram Channels routes registered");

    app.use('/api/support', supportRoutes);
    log("AI Support routes registered");

    app.use('/api/autonomous', autonomousRouter);
    log("Autonomous AI routes registered");

    registerXmlRiverRoutes(app);
    log("XMLRiver API routes registered");

    registerFalAiImageRoutes(app);
    log("FAL.AI Universal Image Generation routes registered");

    registerDeepSeekModelsRoute(app);
    log("DeepSeek Models route registered");

    registerBegetS3Routes(app);
    log("Beget S3 routes registered");

    try {
      const clearCacheRouter = (await import('./routes/clear-cache')).default;
      app.use('/api', clearCacheRouter);
      log("Clear cache routes registered");
    } catch (err) {
      log(`clear-cache routes skipped: ${err instanceof Error ? err.message : err}`);
    }

    app.use('/api', adminUsersRoutes);
    app.use('/api', promoCodesRouter);
    app.use('/api', subscriptionsRouter);
    app.use('/api', yookassaRouter);
    app.use('/api/s3', begetS3Routes);
    app.use('/api/real-video-converter', realVideoConverterRoutes);
    app.use('/api/web-crawler', webCrawlerRoutes);

    log("Route registration completed");

    // Глобальный обработчик ошибок
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error(`🚨 [GLOBAL-ERROR] ${req.method} ${req.path} -> ${status}: ${message}`);
      if (err.stack) console.error(err.stack);

      if (req.path.startsWith('/api')) {
        return res.status(status).json({
          error: message,
          path: req.path,
          details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
      }

      res.status(status).json({ message });
    });

    // 404 handler для API (чтобы не отдавать HTML)
    app.use('/api/*', (req, res) => {
      console.warn(`🔍 [404] API route not found: ${req.method} ${req.originalUrl}`);
      res.status(404).json({ error: 'API route not found', path: req.originalUrl });
    });

    // Настраиваем Vite или статические файлы в зависимости от окружения
    const isProduction = process.env.NODE_ENV === 'production';
    console.log(`DEBUG: Environment is production: ${isProduction}`);

    if (isProduction) {
      console.log("DEBUG: Setting up static files for production...");
      log("Production mode: serving static files with PWA caching...");
      try {
        // Import модулей для production static serving
        const urlModule = await import('url');
        const pathModule = await import('path');
        const fsModule = await import('fs');

        const __filename = urlModule.fileURLToPath(import.meta.url);
        const __dirname = pathModule.dirname(__filename);
        console.log(`DEBUG: __dirname: ${__dirname}`);
        // Исправлено: фронтенд находится в dist/public, а не в public
        const distPath = pathModule.resolve(process.cwd(), "dist", "public");
        console.log(`DEBUG: Attempting to serve static from: ${distPath}`);

        if (!fsModule.existsSync(distPath)) {
          console.log(`DEBUG: distPath NOT FOUND: ${distPath}, falling back to Vite dev server`);
          log("Dist not found, starting Vite dev server...");
          const { setupVite } = await import('./vite.js');
          await setupVite(app, server);
          log("✅ Vite dev server started (fallback)");
        } else {
          console.log(`DEBUG: distPath FOUND: ${distPath}`);
          // Статические файлы с агрессивным кешированием (навсегда)
          app.use(express.static(distPath, {
            maxAge: '31536000000', // 1 год в миллисекундах
            immutable: true,
            setHeaders: (res, filePath) => {
              // JS, CSS, изображения, шрифты - кешируем навсегда
              if (filePath.match(/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|ico)$/)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              }
              // index.html - не кешируем (пользователь может обновить через Ctrl+Shift+R)
              else if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
              }
            }
          }));

          // Fallback на index.html для SPA (исключая API запросы и статические ассеты)
          app.use("*", (req, res, next) => {
            if (req.path.startsWith('/api')) {
              return next();
            }
            // Статические ассеты (js, css, etc.) которых нет на диске → 404, не index.html
            // Иначе браузер попытается распарсить index.html как JS и упадёт
            if (req.path.startsWith('/assets/')) {
              return res.status(404).end();
            }
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.sendFile(pathModule.resolve(distPath, "index.html"));
          });
          log(`Static files served from: ${distPath} with PWA caching`);
        }
      } catch (staticError) {
        log(`Error serving static files: ${staticError instanceof Error ? staticError.message : 'Unknown error'}`);
        throw staticError; // В production это критическая ошибка
      }
    } else {
      log("Development mode: serving PRODUCTION BUILD for Telegram cache compatibility");

      try {
        // КРИТИЧНО: Serve production build в dev для Telegram Mini App
        // Telegram кеширует модули без хешей, поэтому используем production build с хешами
        const pathModule = await import('path');
        const fsModule = await import('fs');
        const distPath = pathModule.resolve(process.cwd(), "dist", "public");

        // Если dist/public не существует — используем Vite dev server
        if (!fsModule.existsSync(distPath)) {
          log("dist/public not found in dev mode, starting Vite dev server...");
          const { setupVite } = await import('./vite.js');
          await setupVite(app, server);
          log("✅ Vite dev server started");
        } else {

        // Dev режим - все файлы без кеша чтобы избежать stale-chunk ошибок при пересборке
        app.use(express.static(distPath, {
          maxAge: 0,
          etag: false,
          lastModified: false,
          setHeaders: (res) => {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        }));

        // Fallback на index.html для SPA (исключая API запросы и статические ассеты)
        app.get("*", (req, res, next) => {
          if (req.path.startsWith('/api') || req.path.startsWith('/server-api')) {
            return next();
          }
          // Статические ассеты которых нет на диске → 404, не index.html
          if (req.path.startsWith('/assets/')) {
            return res.status(404).end();
          }
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');

          const indexPath = pathModule.resolve(distPath, "index.html");

          res.sendFile(indexPath, (err) => {
            if (err) {
              if (!res.headersSent) {
                res.status(200).send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="3">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMM Manager — загрузка...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; background: #f8f9fa; color: #333; }
    .box { text-align: center; padding: 2rem; }
    .spinner { width: 40px; height: 40px; border: 3px solid #e0e0e0;
               border-top-color: #3b82f6; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #666; font-size: 14px; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <h2 style="margin:0">SMM Manager</h2>
    <p>Приложение загружается, подождите...</p>
  </div>
</body>
</html>`);
              }
            }
          });
        });

        log(`✅ Production build served from: ${distPath} (for Telegram compatibility)`);
        } // end else (distPath exists)
      } catch (staticError) {
        log(`Error serving static files: ${staticError instanceof Error ? staticError.message : 'Unknown error'}`);
      }
    }

    // Всегда используем PORT из окружения или 5000
    const PORT = parseInt(process.env.PORT || "5000", 10);
    console.log(`=== STARTING SERVER ON PORT ${PORT} ===`);
    log(`Attempting to start server on port ${PORT}...`);

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`=== SERVER SUCCESSFULLY STARTED ON PORT ${PORT} ===`);
      log(`Server successfully started on port ${PORT}`);

      // Печатаем URL-адрес приложения
      console.log(`=== SERVER URL: http://0.0.0.0:${PORT} ===`);

      // Логируем информацию об окружении
      logEnvironmentInfo();

      // Инициализируем тяжелые сервисы после успешного запуска сервера
      initializeHeavyServices();

      // Восстанавливаем автономный режим для кампаний которые были активны до рестарта
      setTimeout(() => {
        restoreAutonomousStates();
      }, 10000);

      // Ежедневный планировщик сбора трендов ОТКЛЮЧЁН:
      // сбор трендов запускается только вручную пользователем
      // startDailyTrendScheduler(getActiveAutonomousCampaignIds);

      // Запускаем валидатор статусов публикаций для автоматического исправления некорректных статусов
      setTimeout(() => {
        log('Запуск валидатора статусов публикаций', 'status-validator');
        if (statusValidator && typeof statusValidator.startValidation === 'function') {
          statusValidator.startValidation();
        } else {
          console.warn('⚠️ statusValidator.startValidation is not a function or statusValidator is undefined');
        }
      }, 30000); // Задержка 30 секунд для завершения инициализации всех сервисов

      // Запускаем планировщик публикаций с поддержкой индивидуального времени платформ
      setTimeout(() => {
        log('Запуск планировщика публикаций с поддержкой N8N', 'scheduler');
        const scheduler = getPublishScheduler();
        scheduler.start();
        log('✅ Планировщик публикаций успешно запущен', 'scheduler');
      }, 35000); // Задержка 35 секунд для завершения инициализации всех сервисов

      // Авторефреш VK токенов отключён — обновление происходит только при публикации

      // Запускаем Telegram бота
      setTimeout(async () => {
        try {
          log('Запуск Telegram бота...', 'telegram-bot');
          await startTelegramBot();
          log('Telegram бот успешно запущен', 'telegram-bot');
        } catch (error) {
          log(`⚠️ Не удалось запустить Telegram бота: ${error}`, 'telegram-bot');
        }
      }, 5000); // Запускаем через 5 секунд (бот не зависит от тяжелых сервисов)
    }).on('error', (err: NodeJS.ErrnoException) => {
      console.log(`=== SERVER START ERROR: ${err.message} ===`);
      if (err.code === 'EADDRINUSE') {
        log(`Fatal error: Port ${PORT} is already in use. Please ensure no other process is using this port.`);
      } else {
        log(`Fatal error starting server: ${err.message}`);
      }
      process.exit(1);
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`FATAL ERROR DURING SERVER STARTUP: ${errorMsg}`);
    if (errorStack) console.error(errorStack);
    log(`Fatal error during server startup: ${errorMsg}`, 'system', 'error');
    process.exit(1);
  }
})();

// CRITICAL: Global Memory Cleanup для предотвращения OOM на продакшене
function performGlobalMemoryCleanup() {
  try {
    log('🚨 MEMORY: Запуск глобальной очистки памяти', 'memory-cleanup');

    // Принудительная сборка мусора если доступна
    if (global.gc) {
      global.gc();
      log('🧹 Принудительная сборка мусора выполнена', 'memory-cleanup');
    }

    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    log(`💾 Память: ${memMB}MB`, 'memory-cleanup');

    if (memMB > 1024) {
      log(`⚠️ ВЫСОКОЕ потребление памяти: ${memMB}MB`, 'memory-cleanup');
    }
  } catch (error) {
    log(`Ошибка глобальной очистки памяти: ${error}`, 'memory-cleanup');
  }
}

// Запускаем очистку памяти каждые 30 минут
setInterval(performGlobalMemoryCleanup, 30 * 60 * 1000);


// ======================================================
// Фоновая проверка VK токенов (каждые 30 минут) — мониторинг статуса
async function checkVkTokensStatus() {
  try {
    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
    const directusUrl = process.env.DIRECTUS_URL;
    if (!adminToken || !directusUrl) return;

    const { default: axiosInst } = await import('axios');
    const resp = await axiosInst.get(`${directusUrl}/items/user_campaigns`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { limit: -1, fields: 'id,title,social_media_settings' }
    });

    const campaigns: any[] = resp.data?.data || [];
    let active = 0, expired = 0, noToken = 0;

    for (const campaign of campaigns) {
      const vk = campaign.social_media_settings?.vk;
      if (!vk?.accessToken && !vk?.token) { noToken++; continue; }
      if (vk.authExpired) {
        expired++;
        log(`[VK-CHECK] Кампания ${campaign.id} (${campaign.title || ''}): authExpired=true, требует переподключения`, 'vk-cron', 'warn');
        continue;
      }
      const expiresAt = vk.tokenExpiresAt ? new Date(vk.tokenExpiresAt).getTime() : 0;
      const minsLeft = expiresAt ? Math.round((expiresAt - Date.now()) / 60000) : null;
      if (minsLeft !== null && minsLeft < 30) {
        log(`[VK-CHECK] Кампания ${campaign.id}: токен истекает через ${minsLeft} мин`, 'vk-cron', 'warn');
      }
      active++;
    }

    log(`[VK-CHECK] Статус: активных=${active}, истёкших=${expired}, без токена=${noToken}`, 'vk-cron');
  } catch (e: any) {
    log(`[VK-CHECK] Ошибка: ${e.message}`, 'vk-cron', 'error');
  }
}

// Первая проверка через 5 минут после старта, затем каждые 30 минут
setTimeout(() => {
  checkVkTokensStatus();
  setInterval(checkVkTokensStatus, 30 * 60 * 1000);
}, 5 * 60 * 1000);

// Фоновое обновление истекающих VK токенов — каждые 6 часов.
// Первый запуск через 3 минуты после старта (чтобы сервер успел полностью инициализироваться).
setTimeout(async () => {
  try {
    const { refreshAllExpiringVkTokens } = await import('./services/vk-token-refresh');
    log('[VK-CRON] Первый запуск фонового обновления VK токенов', 'vk-cron');
    await refreshAllExpiringVkTokens();
  } catch (e: any) {
    log(`[VK-CRON] Ошибка первого запуска: ${e.message}`, 'vk-cron', 'error');
  }
  setInterval(async () => {
    try {
      const { refreshAllExpiringVkTokens } = await import('./services/vk-token-refresh');
      await refreshAllExpiringVkTokens();
    } catch (e: any) {
      log(`[VK-CRON] Ошибка: ${e.message}`, 'vk-cron', 'error');
    }
  }, 30 * 60 * 1000); // каждые 30 минут
}, 3 * 60 * 1000);

// Graceful shutdown для всех сервисов
function gracefulShutdown(signal: string) {
  log(`🔴 Получен сигнал ${signal}, выполняем graceful shutdown`, 'shutdown');

  try {
    // Закрываем HTTP сервер, чтобы освободить порт 5000
    if (server && server.listening) {
      server.close(() => {
        log('HTTP сервер успешно закрыт, порт освобожден', 'shutdown');
      });
    }

    // Останавливаем все сервисы
    const scheduler = getPublishScheduler();
    if (scheduler?.shutdown) scheduler.shutdown();

    performGlobalMemoryCleanup();

    // Даем небольшую задержку для закрытия соединений
    setTimeout(() => {
      process.exit(0);
    }, 500);
  } catch (error) {
    log(`Ошибка при graceful shutdown: ${error}`, 'shutdown');
    process.exit(1);
  }
}

// Обработка сигналов завершения
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Глобальный обработчик необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('FATAL: Uncaught Exception:', error);
  log(`CRITICAL ERROR: Uncaught Exception: ${error.message}`, 'system', 'fatal');
  performGlobalMemoryCleanup(); // Очистка памяти при критических ошибках
  process.exit(1);
});

// Глобальный обработчик необработанных отклонений промисов
process.on('unhandledRejection', (reason) => {
  console.error('FATAL: Unhandled Promise Rejection:', reason);
  log(`CRITICAL ERROR: Unhandled Promise Rejection: ${reason instanceof Error ? reason.message : 'Unknown reason'}`, 'system', 'fatal');
  performGlobalMemoryCleanup(); // Очистка памяти при отклонении промисов
  process.exit(1);
});
