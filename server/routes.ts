import express, { Express, Request, Response } from "express";
import { createServer, Server } from "http";
import { log } from "./utils/logger";

// Импорт роутеров
import storiesRouter from './routes/stories';
import videoRouter from './routes/video';
import tutorialsRouter from './routes/tutorials';
import realVideoConverterRouter from './routes/real-video-converter';
import videoProcessingRoutes from './routes/videoProcessing';
import reportsRouter from './routes/reports';
import youtubeAuthRouter from './routes/youtube-auth';
import instagramSettingsRouter from './routes/campaign-instagram-settings';

// Импорт вебхуков
import telegramWebhookRoutes from './api/telegram-webhook-direct';
import vkWebhookRoutes from './api/vk-webhook-direct';
import instagramWebhookRoutes from './api/instagram-webhook-direct';
import facebookWebhookUnifiedRoutes from './api/facebook-webhook-unified';
import socialPlatformStatusWebhookRoutes from './api/social-platform-status-webhook';
import instagramCarouselWebhookRoutes from './api/instagram-carousel-direct';

// Импорт API роутов
import { registerValidationRoutes } from './api/validation-routes';
import { registerPublishingRoutes } from './api/publishing-routes';
import { registerAuthRoutes } from './api/auth-routes';
import { registerTokenRoutes } from './api/token-routes';
import { forceUpdateStatusRouter } from './api/force-update-status';
import clipsPublishingRouter from './api/clips-publishing-router';
import { registerTestInstagramCarouselRoute } from './api/test-instagram-carousel-route';

// Импорт модульных роутов (новый рефакторинг)
import { registerAiRoutes } from './routes/ai';
import { registerCampaignRoutes } from './routes/campaigns';
import { registerContentRoutes } from './routes/content';
import { registerAnalyticsRoutes } from './routes/analytics';
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
      };
    }
  }
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // Регистрация существующих роутеров
  // app.use(storiesRouter); // Removed: handled in server/index.ts at /api/stories
  // app.use('/api/video', videoRouter); // Handled in index.ts
  app.use('/api/tutorials', tutorialsRouter);
  // app.use('/api/real-video-converter', realVideoConverterRouter); // Handled in index.ts
  // app.use('/api/video-processing', videoProcessingRoutes); // Handled in index.ts
  app.use('/api/reports', reportsRouter);
  // app.use('/api', youtubeAuthRouter); // Handled in index.ts
  // app.use('/api', instagramSettingsRouter); // Handled in index.ts

  // Регистрация вебхуков
  app.use(telegramWebhookRoutes);
  app.use(vkWebhookRoutes);
  app.use(instagramWebhookRoutes);
  app.use(facebookWebhookUnifiedRoutes);
  app.use(socialPlatformStatusWebhookRoutes);
  app.use(instagramCarouselWebhookRoutes);

  // Регистрация API роутов
  registerValidationRoutes(app);
  registerPublishingRoutes(app);
  // registerAuthRoutes(app); // Handled in index.ts
  registerTokenRoutes(app);
  // app.use('/api', forceUpdateStatusRouter); // Handled in index.ts
  // app.use('/api', clipsPublishingRouter); // Handled in index.ts
  registerTestInstagramCarouselRoute(app);

  // Регистрация модульных роутов
  registerContentPlanRoutes(app);
  registerSocialRoutes(app);
  registerAiRoutes(app);
  registerCampaignRoutes(app);
  registerContentRoutes(app);
  // registerAnalyticsRoutes(app); // Handled in index.ts
  registerAdminRoutes(app);
  registerDebugRoutes(app);
  registerUserRoutes(app);

  // Запускаем сервис проверки статусов публикаций
  publicationStatusChecker.start();

  // Возвращаем HTTP сервер для использования в main файле
  return httpServer;
}
