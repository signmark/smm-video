import { Express } from "express";
import { globalApiKeysService } from './services/global-api-keys';

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

  // Публичный эндпоинт цен тарифов
  // Приоритет: Directus global_api_keys → env vars → дефолты
  app.get('/api/config/pricing', async (_req, res) => {
    const getNum = async (directusKey: string, envKey: string, fallback: number): Promise<number> => {
      try {
        const val = await globalApiKeysService.getGlobalApiKey(directusKey);
        if (val) return Number(val);
      } catch {}
      return Number(process.env[envKey] ?? process.env[`VITE_${envKey}`] ?? fallback);
    };

    const [proPrice, proOriginal, basicPrice, basicOriginal] = await Promise.all([
      getNum('PLAN_PRICE_PRO',          'PLAN_PRICE_PRO',          670),
      getNum('PLAN_PRICE_PRO_ORIGINAL', 'PLAN_PRICE_PRO_ORIGINAL', 1990),
      getNum('PLAN_PRICE_BASIC',        'PLAN_PRICE_BASIC',        390),
      getNum('PLAN_PRICE_BASIC_ORIGINAL','PLAN_PRICE_BASIC_ORIGINAL',990),
    ]);

    res.json({
      pro:   { price: proPrice,   original: proOriginal   },
      basic: { price: basicPrice, original: basicOriginal },
    });
  });

  // Запускаем сервис проверки статусов публикаций
  publicationStatusChecker.start();
}
