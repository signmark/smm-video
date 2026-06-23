import { Express } from "express";

// Роутеры, регистрируемые здесь. Остальные (auth, video, stories, analytics и т.д.)
// монтируются в server/index.ts — порядок монтирования там критичен.
import tutorialsRouter from './routes/tutorials';
import reportsRouter from './routes/reports';

// Вебхуки публикации (вызываются n8n, монтируются в корень без префикса /api)
import telegramWebhookRoutes from './api/telegram-webhook-direct';
import vkWebhookRoutes from './api/vk-webhook-direct';
import instagramWebhookRoutes from './api/instagram-webhook-direct';
import facebookWebhookUnifiedRoutes from './api/facebook-webhook-unified';
import socialPlatformStatusWebhookRoutes from './api/social-platform-status-webhook';
import instagramCarouselWebhookRoutes from './api/instagram-carousel-direct';

// API роуты
import { registerValidationRoutes } from './api/validation-routes';
import { registerPublishingRoutes } from './api/publishing-routes';
import { registerTokenRoutes } from './api/token-routes';
import { registerTestInstagramCarouselRoute } from './api/test-instagram-carousel-route';

// Модульные роуты
import { registerAiRoutes } from './routes/ai';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerContentRoutes } from './routes/content';
import { registerContentPlanRoutes } from './routes/content-plan';
import { registerSocialRoutes } from './routes/social';
import { registerAdminRoutes } from './routes/admin';
import { registerDebugRoutes } from './routes/debug';
import { registerUserRoutes } from './routes/user';
import { publicationStatusChecker } from './services/status-checker';

// Расширяем типы Express.Request
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        token: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        is_smm_admin?: boolean;
        tokenExpired?: boolean;
      };
    }
  }
}

export function registerRoutes(app: Express): void {
  app.use('/api/tutorials', tutorialsRouter);
  app.use('/api/reports', reportsRouter);

  // Вебхуки
  app.use(telegramWebhookRoutes);
  app.use(vkWebhookRoutes);
  app.use(instagramWebhookRoutes);
  app.use(facebookWebhookUnifiedRoutes);
  app.use(socialPlatformStatusWebhookRoutes);
  app.use(instagramCarouselWebhookRoutes);

  // API роуты
  registerValidationRoutes(app);
  registerPublishingRoutes(app);
  registerTokenRoutes(app);
  if (process.env.NODE_ENV !== 'production') {
    registerTestInstagramCarouselRoute(app);
  }

  // Модульные роуты
  registerContentPlanRoutes(app);
  registerSocialRoutes(app);
  registerAiRoutes(app);
  registerCampaignRoutes(app);
  registerContentRoutes(app);
  registerAdminRoutes(app);
  registerDebugRoutes(app);
  registerUserRoutes(app);

  // Публичный эндпоинт цен тарифов — читается из env в runtime, без пересборки
  app.get('/api/config/pricing', (_req, res) => {
    // Читаем из env — поддерживаем оба варианта имён (PLAN_PRICE_* и VITE_PLAN_PRICE_*)
    res.json({
      pro: {
        price:    Number(process.env.PLAN_PRICE_PRO    ?? process.env.VITE_PLAN_PRICE_PRO    ?? 670),
        original: Number(process.env.PLAN_PRICE_PRO_ORIGINAL ?? process.env.VITE_PLAN_PRICE_PRO_ORIGINAL ?? 1990),
      },
      basic: {
        price:    Number(process.env.PLAN_PRICE_BASIC    ?? process.env.VITE_PLAN_PRICE_BASIC    ?? 390),
        original: Number(process.env.PLAN_PRICE_BASIC_ORIGINAL ?? process.env.VITE_PLAN_PRICE_BASIC_ORIGINAL ?? 990),
      },
    });
  });

  // Запускаем сервис проверки статусов публикаций
  publicationStatusChecker.start();
}
