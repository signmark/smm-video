import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import { telegramHttp, getTelegramAgent } from '../services/social-platforms/telegram-http';
import { toSafeErrorDetails } from '../utils/safe-error';
import { error as logError, logEvent, log } from '../utils/logger';
import { notifySubscriptionActivated } from '../services/subscription-notify';
import * as fs from 'fs';
import * as path from 'path';
import { telegramSessionStorage } from '../services/telegram-session-storage';
import { directusAuthManager } from '../services/directus-auth-manager';
import { applySubscription } from '../services/apply-subscription';
import { markSubscriptionProcessed, getSubscriptionStatus } from '../routes/subscriptions';

interface BotSession {
  userId?: string;
  token?: string;
  refreshToken?: string; // Добавлен refresh token для автообновления
  email?: string;
  firstName?: string;
  lastName?: string;
  awaitingAuth?: 'email' | 'password';
  tempEmail?: string;
  tempPassword?: string;
  awaitingInput?: string;
  currentCampaignId?: string;
  currentContentId?: string;
  editingContentId?: string;
  contentPage?: number;
  lastGeneratedContent?: string;
  lastGeneratedCampaignId?: string;
  editingGeneratedContent?: boolean;
  schedulingContentId?: string;
  schedulingStep?: 'date' | 'time' | 'platforms';
  schedulingDate?: string;
  schedulingTime?: string;
  schedulingPlatforms?: string[];
  uploadedPhotoUrl?: string;
  uploadedPhotoCampaignId?: string;
  uploadedPhotoText?: string;
  targetCampaignId?: string;
  selectedImageModel?: string;
  imageGenerationForCampaign?: string;
}

interface BotContext extends Context {
  session: BotSession;
}

// Улучшенная функция определения базового URL API
const getApiBaseUrl = () => {
  // 1. В Replit всегда используем публичный домен Replit
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  // 2. Ищем адрес в переменных окружения (API_BASE_URL, PUBLIC_URL или APP_URL)
  let baseUrl = process.env.API_BASE_URL || process.env.PUBLIC_URL || process.env.APP_URL;

  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/$/, '');

    // В продакшене принудительно используем HTTPS, если протокол не указан
    if (process.env.NODE_ENV === 'production' && !baseUrl.startsWith('http')) {
      baseUrl = `https://${baseUrl}`;
    }

    return baseUrl;
  }

  // 3. Fallback для локальной разработки
  if (process.env.NODE_ENV === 'production') {
    log.warn('⚠️ [TELEGRAM-BOT] ВНИМАНИЕ: API_BASE_URL не задан в режиме продакшена!');
    log.warn('   Кнопки Web App могут не работать без публичного HTTPS URL.');
  }

  return 'http://localhost:5000';
};

const API_BASE_URL = getApiBaseUrl();
log.debug(`[TELEGRAM-BOT] API_BASE_URL: ${API_BASE_URL}`);
const DIRECTUS_URL = process.env.DIRECTUS_URL;

if (!DIRECTUS_URL) {
  log.error('❌ Ошибка: DIRECTUS_URL не задан в .env для Telegram бота');
}

class TelegramBotService {
  private bot: Telegraf<BotContext>;
  private sessions: Map<number, BotSession> = new Map();
  private sessionSyncInterval?: NodeJS.Timeout;

  constructor(token: string) {
    // AI-101 Phase 2C: без агента вся библиотека ходит на api.telegram.org
    // мимо транспорта — long polling, ctx.reply, getFile. Агент читается
    // на каждый вызов (client.js:300), сам объект берётся отсюда один раз.
    // attachmentAgent намеренно не задаём: им качаются произвольные URL
    // медиа (client.js:197), и перебор адресов Telegram увёл бы их не туда.
    this.bot = new Telegraf<BotContext>(token, {
      telegram: { agent: getTelegramAgent() },
    });
    this.setupMiddleware();
    this.setupCommands();
    this.setupHandlers();
    this.startSessionSync();
    // Загружаем все сохраненные сессии при запуске
    this.loadAllSessionsFromDB();
    // Подписываемся на обновление токенов для сохранения в БД
    this.setupTokenRefreshListener();
  }

  /**
   * Настраивает слушатель обновления токенов для сохранения в БД
   */
  private setupTokenRefreshListener(): void {
    global.directusEventEmitter.on('token-refreshed', async (userId: string, success: boolean, newRefreshToken: string) => {
      if (success && newRefreshToken) {
        // Находим chat_id для данного userId
        this.sessions.forEach(async (session, chatId) => {
          if (session.userId === userId) {
            // Обновляем refresh_token в сессии
            session.refreshToken = newRefreshToken;

            // Сохраняем в БД
            try {
              await this.saveSessionToDB(chatId, session);
              log.debug(`[session] refresh_token updated in DB for user ${userId} (chat ${chatId})`);
            } catch (error) {
              console.error(`❌ Ошибка сохранения обновленного refresh_token для пользователя ${userId}:`, error);
            }
          }
        });
      }
    });
  }

  /**
   * Загружает все сохраненные сессии из БД при старте бота
   */
  private async loadAllSessionsFromDB(): Promise<void> {
    try {
      const savedSessions = await telegramSessionStorage.getAllSessions();
      let loadedCount = 0;
      let deletedCount = 0;

      for (const dbSession of savedSessions) {
        // Удаляем старые сессии без refresh_token (они не смогут обновить токены)
        if (!dbSession.refresh_token) {
          log.debug(`[session] removing stale session without refresh_token for chat_id ${dbSession.chat_id}`);
          await telegramSessionStorage.deleteSession(dbSession.chat_id);
          deletedCount++;
          continue;
        }

        const session: BotSession = {
          userId: dbSession.user_id,
          token: dbSession.token,
          refreshToken: dbSession.refresh_token,
          email: dbSession.email,
          firstName: dbSession.first_name,
          lastName: dbSession.last_name,
          ...((dbSession.session_data as BotSession) || {})
        };

        this.sessions.set(dbSession.chat_id, session);
        loadedCount++;
      }

      if (loadedCount > 0) {
        log.debug(`[session] loaded ${loadedCount} sessions from DB at startup`);

        // КРИТИЧНО: Загружаем ВСЕ сессии из БД в DirectusAuthManager разом для proactive refresh
        // Это более эффективно чем upsertSession в цикле
        await directusAuthManager.loadSessionsFromDB();
        log.debug('[session] synced with DirectusAuthManager for proactive refresh');
      }
      if (deletedCount > 0) {
        log.debug(`[session] deleted ${deletedCount} stale sessions without refresh_token`);
      }
    } catch (error) {
      console.error('Ошибка загрузки сессий при старте бота:', error);
    }
  }

  /**
   * Загружает сессию из БД или создает новую
   */
  private async loadSession(chatId: number): Promise<BotSession> {
    try {
      const dbSession = await telegramSessionStorage.getSession(chatId);

      if (dbSession) {
        // Восстанавливаем сессию из БД
        const session: BotSession = {
          userId: dbSession.user_id,
          token: dbSession.token,
          refreshToken: dbSession.refresh_token,
          email: dbSession.email,
          firstName: dbSession.first_name,
          lastName: dbSession.last_name,
          ...((dbSession.session_data as BotSession) || {})
        };

        // КРИТИЧНО: Восстанавливаем refresh_token в кэш для автоматического обновления
        if (session.userId && session.token && session.refreshToken) {
          const { directusApiManager } = await import('../directus');
          // Определяем expires по токену (если есть)
          let expiresIn = 900; // По умолчанию 15 минут
          try {
            const tokenParts = session.token.split('.');
            if (tokenParts.length === 3) {
              const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
              if (payload.exp) {
                const currentTime = Math.floor(Date.now() / 1000);
                expiresIn = Math.max(payload.exp - currentTime, 60); // Минимум 60 секунд
              }
            }
          } catch (e) {
            // Игнорируем ошибки парсинга
          }

          directusApiManager.cacheAuthToken(session.userId, session.token, expiresIn, session.refreshToken);

          // КРИТИЧНО: Также добавляем в DirectusAuthManager для proactive refresh
          directusAuthManager.upsertSession({
            userId: session.userId,
            token: session.token,
            refreshToken: session.refreshToken,
            user: {
              id: session.userId,
              email: session.email || '',
              first_name: session.firstName || '',
              last_name: session.lastName || '',
              role: undefined as any
            }
          });

          log.debug(`[session] restored refresh_token for user ${session.userId} (proactive refresh active)`);
        }

        return session;
      }
    } catch (error) {
      console.error(`Ошибка загрузки сессии из БД для chat_id ${chatId}:`, error);
    }

    // Возвращаем пустую сессию если не удалось загрузить
    return {};
  }

  /**
   * Сохраняет сессию в БД включая refresh_token
   */
  private async saveSessionToDB(chatId: number, session: BotSession): Promise<void> {
    try {
      // Разделяем данные на основные поля и дополнительные
      const { userId, token, refreshToken, email, firstName, lastName, ...sessionData } = session;

      await telegramSessionStorage.saveSession(chatId, {
        user_id: userId,
        token: token,
        refresh_token: refreshToken,
        email: email,
        first_name: firstName,
        last_name: lastName,
        session_data: sessionData
      });
    } catch (error) {
      console.error(`Ошибка сохранения сессии в БД для chat_id ${chatId}:`, error);
    }
  }

  /**
   * НОВОЕ: Получает свежий токен для пользователя через DirectusAuthManager
   * Гарантирует что токен действителен, автоматически обновляет если истёк
   * 
   * @param ctx Контекст Telegram бота
   * @returns Свежий токен или null если не удалось получить
   */
  private async getFreshToken(ctx: BotContext): Promise<string | null> {
    if (!ctx.session.userId) {
      log.debug('[GET-TOKEN] No userId in session');
      return null;
    }

    try {
      // Используем getValidToken для гарантированно свежего токена
      const freshToken = await directusAuthManager.getValidToken(ctx.session.userId);

      if (!freshToken) {
        log.debug(`[get-token] expired for user ${ctx.session.userId}`);

        // КРИТИЧНО: Если токен протух и не может быть обновлен, очищаем сессию
        // чтобы пользователь мог заново авторизоваться через /login
        log.debug(`[get-token] clearing session for user ${ctx.session.userId}`);
        ctx.session.userId = undefined;
        ctx.session.token = undefined;
        ctx.session.refreshToken = undefined;

        // Удаляем сессию из БД
        if (ctx.chat?.id) {
          await telegramSessionStorage.deleteSession(ctx.chat.id);
        }

        return null;
      }

      // Обновляем токен в сессии если он изменился
      if (ctx.session.token !== freshToken) {
        log.debug(`[get-token] refreshed for user ${ctx.session.userId}`);
        ctx.session.token = freshToken;

        // Сохраняем обновлённый токен в БД
        if (ctx.chat?.id) {
          await this.saveSessionToDB(ctx.chat.id, ctx.session);
        }
      }

      return freshToken;
    } catch (error) {
      console.error(`[GET-TOKEN] Error getting fresh token for user ${ctx.session.userId}:`, error);

      // При критической ошибке также очищаем сессию
      log.debug(`[get-token] clearing session after critical error for user ${ctx.session.userId}`);
      ctx.session.userId = undefined;
      ctx.session.token = undefined;
      ctx.session.refreshToken = undefined;

      if (ctx.chat?.id) {
        await telegramSessionStorage.deleteSession(ctx.chat.id);
      }

      return null;
    }
  }

  /**
   * НОВОЕ: Создаёт headers с ГАРАНТИРОВАННО свежим токеном
   * 
   * @param ctx Контекст Telegram бота
   * @returns Headers с Authorization или null если токен недоступен
   */
  private async getAuthHeaders(ctx: BotContext): Promise<{ Authorization: string } | null> {
    const token = await this.getFreshToken(ctx);

    if (!token) {
      // КРИТИЧНО: Информируем пользователя что нужно переавторизоваться
      await ctx.reply('❌ Ваша сессия истекла. Пожалуйста, выполните /login заново').catch(() => { });
      return null;
    }

    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Запускает периодическую синхронизацию сессий с БД
   */
  private startSessionSync(): void {
    // Синхронизируем сессии каждые 5 минут
    this.sessionSyncInterval = setInterval(async () => {
      try {
        // Проверяем доступность БД перед синхронизацией
        const isAvailable = await telegramSessionStorage.checkCollection();

        if (!isAvailable) {
          log.warn('⚠️ БД недоступна, пропускаем синхронизацию сессий');
          return;
        }

        const sessionEntries = Array.from(this.sessions.entries());
        let syncedCount = 0;

        for (const [chatId, session] of sessionEntries) {
          if (session.token) {
            await this.saveSessionToDB(chatId, session);
            syncedCount++;
          }
        }

        if (syncedCount > 0) {
          log.debug(`[session] synced ${syncedCount} sessions with DB`);
        }
      } catch (error) {
        console.error('Ошибка периодической синхронизации сессий:', error);
      }
    }, 5 * 60 * 1000); // 5 минут
  }

  private setupMiddleware() {
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (chatId) {
        if (!this.sessions.has(chatId)) {
          // Загружаем сессию из БД при первом обращении
          const session = await this.loadSession(chatId);
          this.sessions.set(chatId, session);
        }
        ctx.session = this.sessions.get(chatId)!;

        // Автообновление токена если он истекает
        if (ctx.session.userId && ctx.session.token) {
          try {
            const freshToken = await directusAuthManager.getAuthToken(ctx.session.userId, true);
            if (freshToken && freshToken !== ctx.session.token) {
              log.debug(`[session] token refreshed for user ${ctx.session.userId}`);
              ctx.session.token = freshToken;
              // Сохраняем обновленный токен в БД
              await this.saveSessionToDB(chatId, ctx.session);
            }
          } catch (error) {
            console.error('Ошибка автообновления токена в Telegram боте:', error);
          }
        }
      }
      return next();
    });
  }

  private async safeAnswerCallback(ctx: any) {
    try {
      await ctx.answerCbQuery();
    } catch (error: any) {
      // Игнорируем ошибки истекших callback запросов (возникают при перезапуске бота)
      if (!error.message?.includes('query is too old')) {
        console.error('Error answering callback query:', error.message);
      }
    }
  }

  // Разбивает длинное сообщение на части (лимит Telegram - 4096 символов)
  private async sendLongMessage(ctx: BotContext, text: string, parseMode: 'HTML' | 'Markdown' | undefined = 'HTML') {
    const MAX_LENGTH = 4000; // Оставляем запас для заголовков

    if (text.length <= MAX_LENGTH) {
      if (parseMode === 'HTML') {
        return await ctx.replyWithHTML(text);
      } else if (parseMode === 'Markdown') {
        return await ctx.replyWithMarkdown(text);
      } else {
        return await ctx.reply(text);
      }
    }

    // Разбиваем на части
    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        parts.push(remaining);
        break;
      }

      // Ищем ближайший перенос строки или пробел для разбивки
      let splitIndex = MAX_LENGTH;
      const lastNewline = remaining.lastIndexOf('\n', MAX_LENGTH);
      const lastSpace = remaining.lastIndexOf(' ', MAX_LENGTH);

      if (lastNewline > MAX_LENGTH * 0.8) {
        splitIndex = lastNewline + 1;
      } else if (lastSpace > MAX_LENGTH * 0.8) {
        splitIndex = lastSpace + 1;
      }

      parts.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex);
    }

    // Отправляем части
    for (let i = 0; i < parts.length; i++) {
      const partText = i === 0 ? parts[i] : `...\n\n${parts[i]}`;
      const header = i > 0 ? `📄 <b>Часть ${i + 1}/${parts.length}</b>\n\n` : '';

      if (parseMode === 'HTML') {
        await ctx.replyWithHTML(header + partText);
      } else if (parseMode === 'Markdown') {
        await ctx.replyWithMarkdown(partText);
      } else {
        await ctx.reply(partText);
      }

      // Небольшая задержка между сообщениями
      if (i < parts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  }

  private setupCommands() {
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('login', this.handleLogin.bind(this));
    this.bot.command('logout', this.handleLogout.bind(this));
    this.bot.command('menu', this.handleMenu.bind(this));
    this.bot.command('campaigns', this.handleCampaigns.bind(this));
    this.bot.command('new_campaign', this.handleNewCampaign.bind(this));
    this.bot.command('assistant', (ctx) => this.handleAssistant(ctx));
    this.bot.command('autonomous', this.handleAutonomousStart.bind(this));
    this.bot.command('stop_autonomous', this.handleAutonomousStop.bind(this));
    this.bot.command('autonomous_status', this.handleAutonomousStatus.bind(this));
    this.bot.command('help', this.handleHelp.bind(this));

    this.setBotCommands();
  }

  private async setBotCommands() {
    try {
      // Принудительно очищаем старые команды и устанавливаем новые
      await this.bot.telegram.deleteMyCommands();
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Начать работу с ботом' },
        { command: 'login', description: '🔑 Войти в систему' },
        { command: 'logout', description: '🚪 Выйти из системы' },
        { command: 'menu', description: '📱 Главное меню' },
        { command: 'campaigns', description: '📋 Список кампаний' },
        { command: 'new_campaign', description: '➕ Создать новую кампанию' },
        { command: 'assistant', description: '🤖 AI Ассистент' },
        { command: 'autonomous', description: '⚡ Автономный режим (вкл)' },
        { command: 'stop_autonomous', description: '⏹️ Автономный режим (выкл)' },
        { command: 'autonomous_status', description: '📊 Статус автономного режима' },
        { command: 'help', description: '❓ Помощь' }
      ]);
      log.info('✅ Команды бота успешно зарегистрированы в Telegram');
    } catch (error) {
      console.error('❌ Ошибка регистрации команд бота:', error);
    }
  }

  private setupHandlers() {
    this.bot.on(message('text'), this.handleTextMessage.bind(this));
    this.bot.on(message('photo'), this.handlePhotoMessage.bind(this));
    this.bot.on(message('voice'), this.handleVoiceMessage.bind(this));
    this.setupCallbackHandlers();
  }

  private setupCallbackHandlers() {
    // Callback для кнопки "Войти в бота" из /start
    this.bot.action('login', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleLogin(ctx);
    });

    this.bot.action('action_generate_content', async (ctx) => {
      try {
        await this.safeAnswerCallback(ctx);
      } catch (error: any) {
        // Игнорируем ошибки истекших callback запросов
        if (!error.message?.includes('query is too old')) {
          console.error('Error answering callback query:', error.message);
        }
      }
      await this.handleGenerateContent(ctx);
    });

    this.bot.action('action_generate_image', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleGenerateImage(ctx);
    });

    this.bot.action('action_show_campaigns', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleCampaigns(ctx);
    });

    this.bot.action('action_new_campaign', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleNewCampaign(ctx);
    });

    this.bot.action('action_continue_chat', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.awaitingInput = 'assistant_message';
      await ctx.reply('💬 Продолжайте диалог. Напишите ваше сообщение:');
    });

    this.bot.action('action_main_menu', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleMenu(ctx);
    });

    this.bot.action('action_assistant', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleAssistant(ctx);
    });

    this.bot.action('action_show_published', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handlePublishedPosts(ctx);
    });

    this.bot.action('action_campaigns', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleCampaigns(ctx);
    });

    this.bot.action('action_publish', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handlePublish(ctx);
    });

    this.bot.action('action_schedule', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleSchedule(ctx);
    });

    this.bot.action('action_help', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.handleHelp(ctx);
    });

    this.bot.action('action_support', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await ctx.replyWithHTML('💬 <b>Служба поддержки</b>\n\nПо всем вопросам обращайтесь: @smm_nplanner_sup_bot');
    });

    // Обработчики для кампаний - специфичные обработчики ДОЛЖНЫ быть ПЕРВЫМИ
    this.bot.action(/^campaign_generate_content_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      ctx.session.currentCampaignId = campaignId;
      ctx.session.awaitingInput = 'campaign_content_prompt';
      await ctx.reply('✍️ Введите тему или описание для генерации контента:');
    });

    this.bot.action(/^campaign_generate_image_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      ctx.session.currentCampaignId = campaignId;
      await this.showImageModelSelection(ctx, campaignId);
    });

    // Обработчик выбора модели для генерации изображений
    this.bot.action(/^imgmodel_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const modelCode = ctx.match[1];

      // Маппинг коротких кодов на полные ID моделей
      const modelMap: Record<string, string> = {
        'm1': 'schnell',
        'm2': 'rundiffusion-fal/juggernaut-flux-lora',
        'm3': 'fal-ai/fast-sdxl',
        'm4': 'fal-ai/juggernaut-xl-v9'
      };

      const modelId = modelMap[modelCode] || 'schnell';
      ctx.session.selectedImageModel = modelId;

      // Проверяем, генерация для кампании или обычная
      if (ctx.session.imageGenerationForCampaign) {
        ctx.session.currentCampaignId = ctx.session.imageGenerationForCampaign;
        ctx.session.awaitingInput = 'campaign_image_prompt';
        ctx.session.imageGenerationForCampaign = undefined; // Очищаем после использования

        await ctx.reply(`✅ Выбрана модель для генерации.\n\n🎨 Введите описание изображения:`);
      } else {
        ctx.session.awaitingInput = 'generate_image_prompt';

        await ctx.reply(`✅ Выбрана модель для генерации.\n\n🎨 Введите описание изображения:`);
      }
    });

    this.bot.action(/^campaign_info_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.showCampaignInfo(ctx, campaignId);
    });

    this.bot.action(/^campaign_content_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.showCampaignContent(ctx, campaignId);
    });

    this.bot.action(/^content_view_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.showContentDetail(ctx, contentId);
    });

    this.bot.action(/^content_publish_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.publishContent(ctx, contentId);
    });

    this.bot.action(/^content_schedule_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.startScheduling(ctx, contentId);
    });

    // Обработчики для просмотра опубликованных постов
    this.bot.action(/^published_campaign_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.showPublishedPostsByCampaign(ctx, campaignId);
    });

    this.bot.action(/^published_post_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.showPublishedPostDetail(ctx, contentId);
    });

    this.bot.action(/^content_edit_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];

      // КРИТИЧНО: Получаем ГАРАНТИРОВАННО свежий токен через getFreshToken
      const webappToken = await this.getFreshToken(ctx);
      if (!webappToken) {
        await ctx.reply(
          '❌ <b>Ошибка авторизации</b>\n\n' +
          'Не удалось получить токен доступа.\n' +
          'Пожалуйста, выполните /login заново.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Формируем ссылку на web-редактор со свежим токеном
      const editUrl = `${API_BASE_URL}/edit-content/${contentId}?token=${webappToken}`;

      // Кнопка для открытия в WebApp
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp('✍️ Открыть редактор', editUrl)],
        [Markup.button.callback('◀️ Назад', `content_view_${contentId}`)]
      ]);

      await ctx.reply(
        `✍️ <b>Редактирование поста</b>\n\n` +
        `Нажмите кнопку ниже для редактирования контента в удобном веб-редакторе.\n\n` +
        `После сохранения изменения будут сразу применены.`,
        {
          parse_mode: 'HTML',
          ...keyboard
        }
      );
    });

    this.bot.action('save_generated_content', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.saveGeneratedContent(ctx);
    });

    this.bot.action('edit_generated_content', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      // Сбрасываем другие состояния ожидания чтобы избежать конфликтов
      ctx.session.awaitingInput = undefined;
      ctx.session.editingGeneratedContent = true;
      await ctx.reply('✍️ Введите новый текст для поста:');
    });

    // Обработчики публикации в конкретные платформы
    this.bot.action(/^publish_platform_(.+)_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const platform = ctx.match[1];
      const contentId = ctx.match[2];
      await this.actuallyPublishContent(ctx, contentId, [platform]);
    });

    this.bot.action(/^publish_all_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.actuallyPublishContent(ctx, contentId, ['facebook', 'instagram', 'vk', 'telegram', 'youtube']);
    });

    // Обработчики планирования для конкретных платформ
    this.bot.action(/^schedule_platform_(.+)_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const platform = ctx.match[1];
      const contentId = ctx.match[2];
      await this.actuallyScheduleContent(ctx, contentId, [platform]);
    });

    this.bot.action(/^schedule_all_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const contentId = ctx.match[1];
      await this.actuallyScheduleContent(ctx, contentId, ['facebook', 'instagram', 'vk', 'telegram', 'youtube']);
    });

    // Обработчики для работы с загруженными фото
    this.bot.action('photo_add_text', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.awaitingInput = 'photo_text';
      await ctx.reply('✍️ Введите текст для поста с фото:');
    });

    this.bot.action('photo_save_to_campaign', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      // КРИТИЧНО: Проверяем что фото ещё в сессии
      if (!ctx.session.uploadedPhotoUrl) {
        return ctx.reply('❌ Ошибка: фото не найдено. Загрузите или сгенерируйте изображение снова.');
      }
      await this.showCampaignsForContentCreation(ctx);
    });

    this.bot.action('photo_create_in_target', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      if (!ctx.session.targetCampaignId) {
        return ctx.reply('❌ Ошибка: кампания не выбрана');
      }
      await this.createContentWithPhoto(ctx, ctx.session.targetCampaignId);
      ctx.session.targetCampaignId = undefined; // Очищаем после создания
    });

    this.bot.action('photo_cancel', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.uploadedPhotoUrl = undefined;
      ctx.session.uploadedPhotoCampaignId = undefined;
      ctx.session.uploadedPhotoText = undefined;
      ctx.session.targetCampaignId = undefined;
      await ctx.reply('❌ Загрузка фото отменена');
    });

    this.bot.action(/^photo_select_campaign_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.createContentWithPhoto(ctx, campaignId);
    });

    // Обработчик загрузки фото из меню кампании (Вариант 2)
    this.bot.action(/^campaign_upload_photo_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      ctx.session.targetCampaignId = campaignId;
      await ctx.reply('📸 Отправьте фото для создания поста в этой кампании:');
    });

    // Обработчик AI Ассистента для конкретной кампании
    this.bot.action(/^campaign_assistant_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.handleAssistant(ctx, campaignId);
    });

    // Обработчик для интерактивных действий AI
    this.bot.action(/^ai_action_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const action = ctx.match[1];

      // Отправляем действие обратно в AI для выполнения
      ctx.session.awaitingInput = 'assistant_message';
      await this.askAssistant(ctx, action);
    });

    // Обработчики для сохранения сгенерированного контента
    this.bot.action('save_generated_to_current', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      log.debug('[ACTION] save_generated_to_current triggered');
      log.debug('[action] currentCampaignId:', ctx.session.currentCampaignId);
      log.debug('[action] lastGeneratedContent exists:', !!ctx.session.lastGeneratedContent);
      log.debug('[action] lastGeneratedContent length:', ctx.session.lastGeneratedContent?.length);

      if (!ctx.session.currentCampaignId || !ctx.session.lastGeneratedContent) {
        log.debug('[ACTION] ERROR: Missing campaign or content');
        await ctx.reply('❌ Ошибка: нет активной кампании или сгенерированного контента');
        return;
      }
      await this.saveGeneratedContentToCampaign(ctx, ctx.session.currentCampaignId);
    });

    this.bot.action('save_generated_select_campaign', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      if (!ctx.session.lastGeneratedContent) {
        await ctx.reply('❌ Ошибка: нет сгенерированного контента');
        return;
      }
      await this.showCampaignListForSaving(ctx);
    });

    this.bot.action(/^save_generated_to_campaign_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      await this.saveGeneratedContentToCampaign(ctx, campaignId);
    });

    // Одобрение заявки на подписку: sap:{userId}:{days}:{planCode}
    // planCode: b=Базовый, p=Профессиональный, c=Корпоративный
    this.bot.action(/^sap:([^:]+):(\d+):([bpc])$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const userId = ctx.match[1];
      const days = parseInt(ctx.match[2], 10);
      const planCode = ctx.match[3];
      const planNames: Record<string, string> = { b: 'Базовый', p: 'Профессиональный', c: 'Корпоративный' };
      const planName = planNames[planCode] || planCode;
      const planValues: Record<string, string> = { b: 'basic', p: 'pro', c: 'enterprise' };
      const planValue = planValues[planCode] || 'basic';

      // Проверяем, не была ли заявка уже обработана
      const existing = getSubscriptionStatus(userId);
      if (existing) {
        const msg = existing.action === 'rejected'
          ? `⚠️ Эта заявка уже была ОТКЛОНЕНА (через письмо или ранее). Активация отменена.\n🆔 User: ${userId}`
          : `ℹ️ Подписка уже была активирована ранее.\n🆔 User: ${userId}`;
        await ctx.editMessageText(msg).catch(async () => ctx.reply(msg).catch(() => {}));
        return;
      }

      try {
        const directusUrl = process.env.DIRECTUS_URL;
        const adminToken = process.env.DIRECTUS_STATIC_TOKEN;

        if (!adminToken) {
          await ctx.editMessageText('❌ Ошибка: DIRECTUS_STATIC_TOKEN не настроен');
          return;
        }

        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + days);
        const expireDateStr = expireDate.toISOString().split('T')[0];

        // Пишем и ОБЯЗАТЕЛЬНО читаем обратно. 01.08.2026 владелец одобрил
        // тариф, бот ответил «активировано», а в базе осталось старое: успехом
        // считался сам код ответа Directus. 200 означает «запрос принят», а не
        // «поле сохранено» — см. services/apply-subscription.ts.
        const applied = await applySubscription({
          directusUrl,
          adminToken,
          userId,
          planValue,
          expireDateStr,
        });

        logEvent('subscription.approve', {
          source: 'telegram-bot',
          userId,
          plan: planValue,
          days,
          result: applied.ok ? 'applied' : applied.reason,
          ...(applied.ok ? { readback: applied.readback } : {}),
          ...('status' in applied ? { status: applied.status } : {}),
          ...('actual' in applied ? { actual: applied.actual } : {}),
        });

        if (!applied.ok) {
          // Владельцу — честный отказ вместо галочки. Молчаливое «успешно»
          // хуже ошибки: пользователь остаётся без тарифа, и никто не знает.
          const detail = applied.reason === 'not-applied'
            ? `Directus принял запрос, но значение не сохранилось (в базе: ${String(applied.actual.plan)} / ${String(applied.actual.expire_date)})`
            : applied.reason === 'write-failed'
              ? `Directus отклонил запись: ${applied.status}`
              : `Не удалось перечитать значение после записи: ${applied.status}`;
          await ctx.editMessageText(`❌ Тариф НЕ активирован.\n${detail}\n\nПользователь: ${userId}`);
          return;
        }

        // Уведомляем пользователя в Telegram (если есть chat_id)
        try {
          const userResp = await fetch(`${directusUrl}/users/${userId}?fields=telegram_chat_id`, {
            headers: { 'Authorization': `Bearer ${adminToken}` },
          });
          if (userResp.ok) {
            const userJson = await userResp.json();
            const userChatId = userJson.data?.telegram_chat_id;
            if (userChatId) {
              await notifySubscriptionActivated({
                userId,
                chatId: userChatId,
                text: `🎉 Подписка активирована!\n📦 Тариф: ${planName}\n📅 До: ${expireDate.toLocaleDateString('ru-RU')}`,
              });
            } else {
              // AI-65. Тариф выдан, а написать некому. Здесь это странно: заявка
              // пришла через бота, значит Telegram у человека есть.
              logEvent(
                'subscription.confirmation_undelivered',
                { userId, provider: 'telegram', reason: 'chat_id_missing' },
                'warn',
                'subscriptions',
                'Подписка активирована, но получатель подтверждения не найден',
              );
            }
          } else {
            logEvent(
              'subscription.confirmation_undelivered',
              { userId, provider: 'telegram', status: userResp.status, reason: 'chat_id_unreadable' },
              'warn',
              'subscriptions',
              'Подписка активирована, но получателя подтверждения не удалось прочитать',
            );
          }
        } catch (e: any) {
          // AI-65. Тариф уже выдан и записан — падать нельзя. Но человек не
          // получил подтверждения оплаченного тарифа, и до сих пор об этом не
          // оставалось следа.
          logEvent(
            'subscription.confirmation_undelivered',
            { userId, provider: 'telegram', reason: e?.message ? String(e.message) : 'unknown' },
            'warn',
            'subscriptions',
            'Подписка активирована, но подтверждение человеку не доставлено',
          );
        }

        // Помечаем заявку как обработанную — блокирует повторное одобрение через email
        markSubscriptionProcessed(userId, 'approved');

        // Редактируем сообщение у админа — plain text чтобы избежать ошибок HTML-парсинга
        const successMsg =
          `✅ Подписка активирована!\n` +
          `📦 Тариф: ${planName}\n` +
          `📅 До: ${expireDate.toLocaleDateString('ru-RU')}\n` +
          `🆔 User: ${userId}`;

        await ctx.editMessageText(successMsg).catch(async () => {
          await ctx.reply(successMsg).catch(() => {});
        });
      } catch (err: any) {
        console.error('[sap] Ошибка:', err?.message);
        await ctx.editMessageText(`❌ Ошибка: ${err?.message}`).catch(() => {
          ctx.reply(`❌ Ошибка: ${err?.message}`).catch(() => {});
        });
      }
    });

    // Отклонение заявки на подписку: sar:{userId}
    this.bot.action(/^sar:([^:]+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const userId = ctx.match[1];

      // Проверяем, не была ли заявка уже одобрена (через email)
      const existing = getSubscriptionStatus(userId);
      if (existing?.action === 'approved') {
        const msg = `⚠️ Заявка уже была ОДОБРЕНА (через письмо). Если хотите отменить — деактивируйте подписку вручную.\n🆔 User: ${userId}`;
        await ctx.editMessageText(msg).catch(async () => ctx.reply(msg).catch(() => {}));
        return;
      }

      markSubscriptionProcessed(userId, 'rejected');
      await ctx.editMessageText(`❌ Заявка отклонена\n🆔 User: ${userId}`).catch(async () => {
        await ctx.reply(`❌ Заявка отклонена (User: ${userId})`).catch(() => {});
      });
    });

    // Общий обработчик кампании - ДОЛЖЕН быть ПОСЛЕДНИМ
    this.bot.action(/^campaign_(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const campaignId = ctx.match[1];
      ctx.session.currentCampaignId = campaignId;
      await this.showCampaignMenu(ctx, campaignId);
    });
  }

  private async handleStart(ctx: BotContext) {
    const welcomeMessage = `🤖 <b>Добро пожаловать в SMM Manager Bot!</b>

Я помогу вам управлять вашим контентом в социальных сетях прямо из Telegram.

<b>Что я умею:</b>
📱 Создавать и управлять кампаниями
✍️ Генерировать контент с помощью AI
🎨 Создавать изображения и видео
📅 Планировать публикации
🤖 Работать с автономным AI ассистентом
📊 Публиковать контент в соцсети
🔍 Собирать тренды и анализировать данные
🌐 Парсить сайты и подбирать ключевые слова
⚡ Выполнять сложные команды в диалоге

<b>AI может:</b>
• Создать кампанию на основе сайта
• Сгенерировать посты и изображения
• Собрать тренды и запланировать публикации
• Работать автономно 24/7

Для начала работы введите команду /login

━━━━━━━━━━━━━━━━━━━━━━
💬 <b>Поддержка:</b> @smm_nplanner_sup_bot`;

    // Если пользователь уже авторизован - показываем кнопку веб-приложения
    let keyboard;
    if (ctx.session.token && ctx.session.userId) {
      // КРИТИЧНО: Получаем ГАРАНТИРОВАННО свежий токен через getFreshToken
      const webappToken = await this.getFreshToken(ctx);
      if (!webappToken) {
        log.error('Failed to get fresh token for WebApp in handleStart');
        return ctx.reply('❌ Ошибка получения токена. Пожалуйста, выполните /login заново');
      }

      // Telegram использует production build с хешированными файлами
      const webAppUrl = `${API_BASE_URL}?token=${webappToken}`;

      keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp('🌐 Открыть веб-приложение', webAppUrl)],
        [Markup.button.callback('📋 Главное меню', 'action_main_menu')]
      ]);
    } else {
      // Не авторизован - показываем кнопку входа
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📋 Войти в бота', 'login')]
      ]);
    }

    await ctx.replyWithHTML(welcomeMessage, keyboard);
  }

  private async handleLogin(ctx: BotContext) {
    // Проверяем не только наличие токена, но и его валидность
    if (ctx.session.token && ctx.session.userId) {
      try {
        // Пытаемся получить свежий токен через DirectusAuthManager с автообновлением
        const freshToken = await directusAuthManager.getAuthToken(ctx.session.userId, true);
        if (freshToken) {
          // Обновляем токен в сессии если он изменился
          if (freshToken !== ctx.session.token) {
            ctx.session.token = freshToken;
            await this.saveSessionToDB(ctx.chat!.id, ctx.session);
          }
          return ctx.reply('Вы уже авторизованы! Используйте /menu для навигации.');
        }

        // Если freshToken === null, значит refresh_token протух
        log.debug('[refresh-token] expired for userId:', ctx.session.userId);
      } catch (error) {
        log.debug('[refresh-token] error:', error);
      }

      // Токен или refresh_token протух - очищаем сессию для повторного логина
      ctx.session.userId = undefined;
      ctx.session.token = undefined;
      ctx.session.refreshToken = undefined;
      ctx.session.email = undefined;

      const chatId = ctx.chat?.id;
      if (chatId) {
        await telegramSessionStorage.deleteSession(chatId);
      }

      await ctx.reply('⚠️ Ваша сессия истекла и не может быть обновлена.\nПожалуйста, авторизуйтесь заново, введя email:');
    }

    ctx.session.awaitingAuth = 'email';
    await ctx.reply('📧 Введите ваш email:');
  }

  private async handleLogout(ctx: BotContext) {
    ctx.session.userId = undefined;
    ctx.session.token = undefined;
    ctx.session.email = undefined;

    // Удаляем сессию из БД при выходе
    const chatId = ctx.chat?.id;
    if (chatId) {
      await telegramSessionStorage.deleteSession(chatId);
    }

    await ctx.reply('✅ Вы вышли из системы. Для входа используйте /login');
  }

  private async handleWebApp(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    // КРИТИЧНО: Получаем ГАРАНТИРОВАННО свежий токен через getFreshToken
    const webappToken = await this.getFreshToken(ctx);
    if (!webappToken) {
      log.error('Failed to get fresh token for WebApp in handleHelp');
      return ctx.reply('❌ Ошибка получения токена. Пожалуйста, выполните /login заново');
    }

    // URL с токеном для автоавторизации
    const webAppUrl = `${API_BASE_URL}?token=${webappToken}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🌐 Открыть веб-приложение', webAppUrl)]
    ]);

    await ctx.reply(
      '🌐 <b>Веб-приложение SMM Manager</b>\n\n' +
      'Нажмите кнопку ниже чтобы открыть полнофункциональное веб-приложение с визуальным интерфейсом.\n\n' +
      '✅ Вы уже авторизованы - авторизация будет автоматической!',
      {
        parse_mode: 'HTML',
        ...keyboard
      }
    );
  }

  private async handleMenu(ctx: BotContext) {
    if (!ctx.session.token) {
      return ctx.reply('❌ Пожалуйста, сначала авторизуйтесь: /login');
    }

    // КРИТИЧНО: Получаем ГАРАНТИРОВАННО свежий токен через getFreshToken
    const webappToken = await this.getFreshToken(ctx);
    if (!webappToken) {
      log.error('Failed to get fresh token for WebApp in handleMenu');
      return ctx.reply('❌ Ошибка получения токена. Пожалуйста, выполните /login заново');
    }

    const webAppUrl = `${API_BASE_URL}?token=${webappToken}`;
    const aiAssistantUrl = `${API_BASE_URL}/ai-assistant?token=${webappToken}`;

    // Упрощенное меню бота - только основные функции
    const keyboard = Markup.keyboard([
      [Markup.button.webApp('🌐 Веб-приложение', webAppUrl)],
      ['🤖 AI Ассистент', '📋 Кампании']
    ]).resize();

    await ctx.reply('📱 <b>Главное меню</b>\n\nВыберите действие:', {
      parse_mode: 'HTML',
      ...keyboard
    });
  }

  private async handleCampaigns(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaigns`, {
        headers
      });

      const campaigns = response.data.data || response.data;

      if (!campaigns || campaigns.length === 0) {
        return ctx.reply('У вас пока нет кампаний. Создайте новую: /new_campaign');
      }

      const buttons = campaigns.slice(0, 10).map((campaign: any) => [
        Markup.button.callback(
          `📱 ${campaign.name || campaign.title}`,
          `campaign_${campaign.id}`
        )
      ]);

      buttons.push([Markup.button.callback('➕ Создать новую кампанию', 'action_new_campaign')]);

      await ctx.reply(
        '📋 <b>Ваши кампании:</b>\n\nВыберите кампанию для управления:',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (error: any) {
      console.error('Error fetching campaigns:', error);
      await ctx.reply(`❌ Ошибка при получении кампаний: ${error.message}`);
    }
  }

  private async handleNewCampaign(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    ctx.session.awaitingInput = 'new_campaign_name';
    await ctx.reply('📝 Введите название новой кампании:');
  }

  private async handleGenerateContent(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    ctx.session.awaitingInput = 'generate_content_prompt';
    await ctx.reply('✍️ Введите тему или описание для генерации контента:');
  }

  private async handleGenerateImage(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;
    await this.showImageModelSelection(ctx);
  }

  private async showImageModelSelection(ctx: BotContext, forCampaign?: string) {
    // Короткие коды для моделей (чтобы не превысить лимит Telegram в 64 байта для callback_data)
    const models = [
      { code: 'm1', fullId: 'schnell', name: '⚡ Schnell', description: 'Быстрая базовая' },
      { code: 'm2', fullId: 'rundiffusion-fal/juggernaut-flux-lora', name: '🎨 Juggernaut Flux', description: 'Высочайшее качество' },
      { code: 'm3', fullId: 'fal-ai/fast-sdxl', name: '🚀 Fast SDXL', description: 'Быстрая с высоким качеством' },
      { code: 'm4', fullId: 'fal-ai/juggernaut-xl-v9', name: '💎 Juggernaut XL', description: 'Реалистичные изображения' }
    ];

    // Сохраняем campaignId в сессии, если передан
    if (forCampaign) {
      ctx.session.imageGenerationForCampaign = forCampaign;
    }

    const buttons = models.map(model =>
      [Markup.button.callback(`${model.name} - ${model.description}`, `imgmodel_${model.code}`)]
    );

    buttons.push([Markup.button.callback('❌ Отмена', 'action_main_menu')]);

    await ctx.reply(
      '🎨 <b>Выберите модель для генерации изображения:</b>\n\n' +
      '⚡ <b>Schnell</b> - самая быстрая (2-5 сек)\n' +
      '🎨 <b>Juggernaut Flux</b> - наивысшее качество (20-30 сек)\n' +
      '🚀 <b>Fast SDXL</b> - баланс скорости и качества (10-15 сек)\n' +
      '💎 <b>Juggernaut XL</b> - детальная реалистичность (15-20 сек)',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  }

  private async handlePublish(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    await ctx.reply('📊 Функция публикации контента. Сначала создайте контент, затем используйте /publish [content_id]');
  }

  private async showPublishedPostsByCampaign(ctx: BotContext, campaignId: string) {
    if (!this.checkAuth(ctx)) return;

    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      // Получаем посты конкретной кампании
      const response = await axios.get(`${API_BASE_URL}/api/campaign-content`, {
        headers,
        params: {
          campaignId: campaignId,
          limit: 50
        }
      });

      const allPosts = response.data.data || response.data;

      // API уже вернул только посты этой кампании, фильтруем только по статусу
      const publishedPosts = allPosts.filter((post: any) => post.status === 'published');

      if (publishedPosts.length === 0) {
        await ctx.reply(
          '📭 <b>Опубликованные посты не найдены</b>\n\n' +
          'В этой кампании пока нет опубликованных постов.\n' +
          'Начните публиковать контент через /publish',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Показываем список опубликованных постов
      let message = `📊 <b>Опубликованные посты кампании</b>\n\n`;
      message += `Найдено постов: ${publishedPosts.length}\n\n`;

      const buttons = publishedPosts.slice(0, 10).map((post: any) => {
        const title = post.title || post.content?.substring(0, 30) || 'Без названия';
        return [Markup.button.callback(
          `📄 ${title}${title.length > 30 ? '...' : ''}`,
          `published_post_${post.id}`
        )];
      });

      buttons.push([Markup.button.callback('◀️ Назад', `campaign_${campaignId}`)]);

      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (error: any) {
      console.error('[TG-BOT] Error fetching published posts:', error);
      await ctx.reply(`❌ Ошибка при загрузке опубликованных постов: ${error.message}`);
    }
  }

  private async handlePublishedPosts(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      // Получаем все посты пользователя
      const response = await axios.get(`${API_BASE_URL}/api/campaign-content`, {
        headers,
        params: {
          limit: 50
        }
      });

      const allPosts = response.data.data || response.data;

      log.debug(`[tg-bot] received ${allPosts.length} posts`);
      if (allPosts.length > 0) {
        log.debug('[tg-bot] post structure sample:', JSON.stringify({
          id: allPosts[0].id,
          campaign_id: allPosts[0].campaign_id,
          status: allPosts[0].status,
          social_platforms: allPosts[0].social_platforms
        }, null, 2));
      }

      // Фильтруем только опубликованные посты
      const publishedPosts = allPosts.filter((post: any) => {
        const isPublished = post.status === 'published';

        if (isPublished) {
          log.debug(`[tg-bot] found published post: ${post.id}, status: ${post.status}`);
        }

        return isPublished;
      });

      if (publishedPosts.length === 0) {
        await ctx.reply('📭 <b>Опубликованные посты не найдены</b>\n\nНачните публиковать контент через /publish', {
          parse_mode: 'HTML'
        });
        return;
      }

      // Группируем посты по кампаниям
      const postsByCampaign: { [key: string]: any[] } = {};
      for (const post of publishedPosts) {
        const campaignId = post.campaign_id || post.campaignId || 'unknown';
        if (!postsByCampaign[campaignId]) {
          postsByCampaign[campaignId] = [];
        }
        postsByCampaign[campaignId].push(post);
      }

      // Получаем информацию о кампаниях
      const campaignIds = Object.keys(postsByCampaign).filter(id => id !== 'unknown');
      const campaignNames: { [key: string]: string } = {};

      for (const campaignId of campaignIds) {
        try {
          const campResponse = await axios.get(`${API_BASE_URL}/api/campaigns/${campaignId}`, {
            headers
          });
          const campaign = campResponse.data.data || campResponse.data;
          campaignNames[campaignId] = campaign.name || campaign.title || 'Без названия';
        } catch (error) {
          campaignNames[campaignId] = 'Без названия';
        }
      }

      // Формируем сообщение со статистикой
      let message = `📊 <b>Опубликованные посты (${publishedPosts.length})</b>\n\n`;

      for (const [campaignId, posts] of Object.entries(postsByCampaign)) {
        const campaignName = campaignNames[campaignId] || 'Без кампании';
        message += `📁 <b>${campaignName}</b> (${posts.length} ${posts.length === 1 ? 'пост' : 'постов'})\n`;
      }

      message += '\n💡 Нажмите на кампанию, чтобы увидеть её посты:';

      // Создаем кнопки для каждой кампании
      const buttons = Object.entries(postsByCampaign).map(([campaignId, posts]) => {
        const campaignName = campaignNames[campaignId] || 'Без кампании';
        return [Markup.button.callback(
          `📁 ${campaignName} (${posts.length})`,
          `published_campaign_${campaignId}`
        )];
      });

      buttons.push([Markup.button.callback('📱 Главное меню', 'action_main_menu')]);

      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });

    } catch (error: any) {
      console.error('Error fetching published posts:', error);
      await ctx.reply(`❌ Ошибка при получении опубликованных постов: ${error.message}`);
    }
  }

  private async handleSchedule(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    await ctx.reply('📅 Функция планирования публикаций. Формат: /schedule [content_id] [дата время]');
  }

  private async handleAssistant(ctx: BotContext, campaignId?: string) {
    if (!this.checkAuth(ctx)) return;

    // КРИТИЧНО: Получаем ГАРАНТИРОВАННО свежий токен через getFreshToken
    const webappToken = await this.getFreshToken(ctx);
    if (!webappToken) {
      log.error('Failed to get fresh token for AI Assistant WebApp');
      return ctx.reply('❌ Ошибка получения токена. Пожалуйста, выполните /login заново');
    }

    // Используем переданный campaignId или из сессии
    const activeCampaignId = campaignId || ctx.session.currentCampaignId;

    log.debug('[ai-assistant] handleAssistant called:', {
      passedCampaignId: campaignId,
      sessionCampaignId: ctx.session.currentCampaignId,
      activeCampaignId: activeCampaignId
    });

    // URL с токеном для автоавторизации и ID кампании (если есть)
    let aiAssistantUrl = `${API_BASE_URL}/ai-assistant?token=${webappToken}`;
    if (activeCampaignId) {
      aiAssistantUrl += `&campaign_id=${activeCampaignId}`;
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🤖 Открыть AI Ассистента', aiAssistantUrl)]
    ]);

    const message = activeCampaignId
      ? '🤖 <b>AI Помощник</b>\n\nОткройте AI-ассистент для работы с текущей кампанией.'
      : '🤖 <b>AI Помощник</b>\n\nОткройте полнофункциональный AI-ассистент в веб-приложении для удобной работы с вашими кампаниями.';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      ...keyboard
    });
  }

  private async handleHelp(ctx: BotContext) {
    const helpMessage = `📖 <b>Справка по командам:</b>

<b>Основные:</b>
/start - Начать работу
/login - Войти в систему
/logout - Выйти
/menu - Главное меню
/help - Эта справка

<b>Кампании:</b>
/campaigns - Список кампаний
/new_campaign - Создать кампанию

<b>Контент:</b>
/generate_content - Генерация текста
/generate_image - Генерация изображений
/publish - Публикация контента
/schedule - Запланировать публикацию

<b>AI Ассистент:</b>
/assistant - Диалог с AI (умный режим)
/autonomous - Запустить автономный режим
/stop_autonomous - Остановить автономный режим
/autonomous_status - Статус автономного режима

<b>💡 Примеры команд для AI:</b>
• "Создай кампанию для сайта example.com"
• "Сгенерируй 3 поста про новинки"
• "Собери тренды и запланируй публикации"
• "Найди ключевые слова для сайта"
• "Запусти автономный режим"

Для работы с ботом сначала авторизуйтесь через /login

━━━━━━━━━━━━━━━━━━━━━━
💬 <b>Поддержка:</b> @smm_nplanner_sup_bot`;

    await ctx.replyWithHTML(helpMessage);
  }

  private async handleTextMessage(ctx: BotContext) {
    if (!ctx.message || !('text' in ctx.message)) return;
    const text = ctx.message.text;
    if (!text) return;

    // Упрощенное меню - только основные функции
    const menuActions: Record<string, () => Promise<any>> = {
      '🌐 Приложение': () => this.handleWebApp(ctx),
      '🌐 Веб-приложение': () => this.handleWebApp(ctx),
      '📋 Кампании': () => this.handleCampaigns(ctx),
      '🤖 AI Ассистент': () => this.handleAssistant(ctx)
    };

    // Если это кнопка меню - выполняем действие и выходим
    if (ctx.session.token && menuActions[text]) {
      await menuActions[text]();
      return;
    }

    // КРИТИЧНО: Обработка текста для поста с фото ПЕРЕД всеми остальными проверками
    if (ctx.session.awaitingInput === 'photo_text' && ctx.session.uploadedPhotoUrl) {
      ctx.session.uploadedPhotoText = text;
      ctx.session.awaitingInput = undefined;

      await ctx.reply(`✅ Текст добавлен к фото!`);

      // Проверяем, есть ли предвыбранная кампания
      const createButton = ctx.session.targetCampaignId
        ? Markup.button.callback('💾 Создать пост', 'photo_create_in_target')
        : Markup.button.callback('💾 Создать пост', 'photo_save_to_campaign');

      const actionButtons = Markup.inlineKeyboard([
        [createButton],
        [
          Markup.button.callback('✏️ Изменить текст', 'photo_add_text'),
          Markup.button.callback('❌ Отменить', 'photo_cancel')
        ]
      ]);

      const message = ctx.session.targetCampaignId
        ? 'Пост будет создан в выбранной кампании. Что делать дальше?'
        : 'Что делать дальше?';

      return ctx.reply(message, actionButtons);
    }

    // Игнорируем случайный текст если пользователь авторизован и не ждет ввода
    if (ctx.session.userId && ctx.session.token &&
      !ctx.session.awaitingAuth &&
      !ctx.session.awaitingInput &&
      !ctx.session.editingGeneratedContent) {
      // Игнорируем случайные сообщения (НЕ кнопки меню - они уже обработаны выше)
      return;
    }

    if (ctx.session.awaitingAuth === 'email') {
      ctx.session.tempEmail = text;
      ctx.session.awaitingAuth = 'password';
      return ctx.reply('🔒 Введите ваш пароль:');
    }

    if (ctx.session.awaitingAuth === 'password' && ctx.session.tempEmail) {
      ctx.session.tempPassword = text;
      await this.processLogin(ctx);
      ctx.session.awaitingAuth = undefined;
      ctx.session.tempEmail = undefined;
      ctx.session.tempPassword = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'new_campaign_name') {
      await this.createCampaign(ctx, text);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'generate_content_prompt') {
      await this.generateContent(ctx, text);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'generate_image_prompt') {
      await this.generateImage(ctx, text);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'assistant_message') {
      await this.askAssistant(ctx, text);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'campaign_content_prompt' && ctx.session.currentCampaignId) {
      await this.generateContentForCampaign(ctx, text, ctx.session.currentCampaignId);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.awaitingInput === 'campaign_image_prompt' && ctx.session.currentCampaignId) {
      await this.generateImageForCampaign(ctx, text, ctx.session.currentCampaignId);
      ctx.session.awaitingInput = undefined;
      return;
    }

    if (ctx.session.editingGeneratedContent && ctx.session.lastGeneratedCampaignId) {
      // Обновляем контент в сессии
      ctx.session.lastGeneratedContent = text;
      ctx.session.editingGeneratedContent = false;

      // Показываем обновлённый контент
      await this.sendLongMessage(ctx, `✅ <b>Контент обновлён:</b>\n\n${text}`, 'HTML');

      // Показываем кнопки действий
      const campaignId = ctx.session.lastGeneratedCampaignId;
      const actionButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('💾 Сохранить пост', `save_generated_content`),
          Markup.button.callback('✏️ Редактировать', `edit_generated_content`)
        ],
        [
          Markup.button.callback('🔄 Сгенерировать ещё', `campaign_generate_content_${campaignId}`),
          Markup.button.callback('🎨 Создать изображение', `campaign_generate_image_${campaignId}`)
        ],
        [
          Markup.button.callback('◀️ К кампании', `campaign_${campaignId}`),
          Markup.button.callback('📱 Главное меню', 'action_main_menu')
        ]
      ]);

      await ctx.reply('Что делаем дальше?', actionButtons);
      return;
    }

    // Обработка ввода даты для планирования
    if (ctx.session.schedulingStep === 'date' && ctx.session.schedulingContentId) {
      // Валидация формата даты (ДД.ММ.ГГГГ)
      const datePattern = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
      const match = text.match(datePattern);

      if (!match) {
        return ctx.reply('❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ\nНапример: 15.11.2025');
      }

      const [, day, month, year] = match;
      const dayNum = parseInt(day, 10);
      const monthNum = parseInt(month, 10);

      // Базовая валидация
      if (dayNum < 1 || dayNum > 31 || monthNum < 1 || monthNum > 12) {
        return ctx.reply('❌ Некорректная дата. Проверьте день и месяц.\nНапример: 15.11.2025');
      }

      ctx.session.schedulingDate = text;
      ctx.session.schedulingStep = 'time';
      return ctx.reply('⏰ Введите время в формате ЧЧ:ММ\nНапример: 14:30');
    }

    // Обработка ввода времени для планирования
    if (ctx.session.schedulingStep === 'time' && ctx.session.schedulingContentId) {
      // Валидация формата времени (ЧЧ:ММ)
      const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
      const match = text.match(timePattern);

      if (!match) {
        return ctx.reply('❌ Неверный формат времени. Используйте ЧЧ:ММ\nНапример: 14:30');
      }

      ctx.session.schedulingTime = text;
      ctx.session.schedulingStep = 'platforms';
      return this.handleSchedulingPlatforms(ctx);
    }

    // Если пользователь не авторизован - предлагаем логин
    if (!ctx.session.token) {
      return ctx.reply('Используйте /login для авторизации или /help для справки');
    }
  }

  private async handlePhotoMessage(ctx: BotContext) {
    if (!ctx.message || !('photo' in ctx.message)) return;

    // Проверяем авторизацию
    if (!this.checkAuth(ctx)) return;

    try {
      await ctx.reply('📸 Обрабатываю фото...');

      // Получаем самое большое фото (Telegram отправляет массив разных размеров)
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];

      if (!largestPhoto || !largestPhoto.file_id) {
        return ctx.reply('❌ Ошибка: не удалось получить фото');
      }

      // Получаем информацию о файле через Telegram API
      const fileInfo = await ctx.telegram.getFile(largestPhoto.file_id);

      if (!fileInfo.file_path) {
        return ctx.reply('❌ Ошибка: не удалось получить путь к файлу');
      }

      // Скачиваем файл через Telegram API
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return ctx.reply('❌ Ошибка конфигурации: отсутствует токен бота');
      }

      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
      // AI-101 Phase 2B: тот же хост api.telegram.org, значит и тот же перебор адресов.
      const tgFiles = await telegramHttp();
      const response = await tgFiles.get(fileUrl, { responseType: 'arraybuffer' });

      // Сохраняем файл временно
      const tempDir = path.join(process.cwd(), 'uploads', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `telegram-${Date.now()}.jpg`);
      fs.writeFileSync(tempFilePath, response.data);

      await ctx.reply('⏳ Загружаю фото в облако...');

      // Загружаем на Beget S3
      const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
      const imageBuffer = fs.readFileSync(tempFilePath);
      const s3Key = `images/telegram/${Date.now()}-${path.basename(tempFilePath)}`;

      const uploadResult = await begetS3StorageAws.uploadFile({
        key: s3Key,
        fileData: imageBuffer,
        contentType: 'image/jpeg'
      });

      const uploadedUrl = uploadResult.success ? uploadResult.url : null;

      // Удаляем временный файл
      fs.unlinkSync(tempFilePath);

      if (!uploadedUrl) {
        return ctx.reply('❌ Ошибка при загрузке фото в облако. Попробуйте ещё раз.');
      }

      // Сохраняем URL в сессии
      ctx.session.uploadedPhotoUrl = uploadedUrl;

      await ctx.reply(`✅ Фото загружено успешно!`);

      // Проверяем, выбрана ли кампания заранее (Вариант 2)
      if (ctx.session.targetCampaignId) {
        // Показываем кнопки для создания поста в выбранной кампании
        const actionButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback('💾 Создать пост', 'photo_create_in_target')
          ],
          [
            Markup.button.callback('✍️ Добавить текст', 'photo_add_text')
          ],
          [
            Markup.button.callback('❌ Отменить', 'photo_cancel')
          ]
        ]);
        await ctx.reply('Пост будет создан в выбранной кампании. Что делать дальше?', actionButtons);
      } else {
        // Вариант 1: показываем стандартные кнопки
        const actionButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback('💾 Создать пост', 'photo_save_to_campaign')
          ],
          [
            Markup.button.callback('✍️ Добавить текст', 'photo_add_text')
          ],
          [
            Markup.button.callback('❌ Отменить', 'photo_cancel')
          ]
        ]);
        await ctx.reply('Что делать дальше?', actionButtons);
      }
    } catch (error: any) {
      console.error('Error handling photo:', error);
      await ctx.reply(`❌ Ошибка при обработке фото: ${error.message}`);
    }
  }

  /**
   * Человеческая причина отказа. Сырой текст ошибки показывать нельзя: у
   * неудачного скачивания в нём лежит ссылка вида
   * `https://api.telegram.org/file/bot<токен>/…`, то есть токен бота. Берём
   * безопасный разбор ошибки и на всякий случай затираем сам сегмент с токеном.
   */
  private describeFailure(error: unknown): string {
    const detail = toSafeErrorDetails(error);
    // Ошибка программиста человеку ничего не объясняет, а имя внутреннего
    // метода в чате — лишнее. Исходная причина остаётся в журнале сервера.
    if (detail.name === 'TypeError' || detail.name === 'ReferenceError' || detail.name === 'SyntaxError') {
      return 'внутренняя ошибка сервиса';
    }
    const reason =
      typeof detail.status === 'number' ? `сервер ответил ${detail.status}` :
      detail.code ? `сбой связи (${detail.code})` :
      detail.message && detail.message !== 'Unknown error' ? detail.message :
      'причина неизвестна';
    return reason.replace(/\/bot[^\s/]+/gi, '/bot[REDACTED]');
  }

  private async handleVoiceMessage(ctx: BotContext) {
    if (!ctx.message || !('voice' in ctx.message)) return;

    // Проверяем авторизацию
    if (!this.checkAuth(ctx)) return;

    try {
      await ctx.reply('🎤 Обрабатываю голосовое сообщение...');

      const voice = ctx.message.voice;

      if (!voice || !voice.file_id) {
        return ctx.reply('❌ Ошибка: не удалось получить голосовое сообщение');
      }

      // Получаем информацию о файле через Telegram API
      const fileInfo = await ctx.telegram.getFile(voice.file_id);

      if (!fileInfo.file_path) {
        return ctx.reply('❌ Ошибка: не удалось получить путь к файлу');
      }

      // Скачиваем файл через Telegram API
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return ctx.reply('❌ Ошибка конфигурации: отсутствует токен бота');
      }

      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

      // AI-101 Phase 2B: тот же хост api.telegram.org, значит и тот же перебор
      // адресов — как в обработчике фотографий рядом. Файл качаем ЗДЕСЬ, в боте:
      // ссылка содержит токен бота, и отдавать её в сервис распознавания значит
      // расширять область, где токен живёт, без всякой нужды.
      let audioBuffer: Buffer;
      try {
        const tgFiles = await telegramHttp();
        const response = await tgFiles.get(fileUrl, { responseType: 'arraybuffer' });
        audioBuffer = Buffer.from(response.data);
      } catch (error) {
        // Через logger, а не console: он редактирует секреты и не растит
        // храповик прямых вызовов console.* (AI-41).
        logError('Не удалось скачать голосовое сообщение', toSafeErrorDetails(error), 'telegram-bot');
        return ctx.reply(
          `❌ Не удалось скачать голосовое сообщение: ${this.describeFailure(error)}. Попробуйте ещё раз.`,
        );
      }

      await ctx.reply('🔄 Распознаю речь...');

      // Сервис принимает буфер — вторая входная точка ему не нужна.
      const { speechToTextService } = await import('../services/speech-to-text');
      const transcribedText = await speechToTextService.transcribeAudio(audioBuffer, voice.mime_type || 'audio/ogg');

      if (!transcribedText || transcribedText.trim().length === 0) {
        return ctx.reply('❌ Не удалось распознать речь. Попробуйте записать сообщение ещё раз.');
      }

      // Показываем распознанный текст
      await ctx.reply(`✅ <b>Распознано:</b>\n\n${transcribedText}`, { parse_mode: 'HTML' });

      // Автоматически отправляем распознанный текст в AI ассистента
      await this.askAssistant(ctx, transcribedText);

    } catch (error: any) {
      console.error('Error handling voice message:', toSafeErrorDetails(error));
      await ctx.reply(`❌ Ошибка при обработке голосового сообщения: ${this.describeFailure(error)}`);
    }
  }

  private async processLogin(ctx: BotContext) {
    const { tempEmail, tempPassword } = ctx.session;

    if (!tempEmail || !tempPassword) {
      return ctx.reply('❌ Ошибка авторизации. Попробуйте снова: /login');
    }

    try {
      // В dev окружении используем локальный API, в prod - Directus напрямую
      const isDev = process.env.NODE_ENV !== 'production' || API_BASE_URL.includes('localhost') || API_BASE_URL.includes('replit.dev');

      let response;
      let token;
      let user;

      if (isDev) {
        // Dev: используем локальный API endpoint с запросом суточного токена
        response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
          email: tempEmail,
          password: tempPassword
        });
        token = response.data.token;
        user = response.data.user;
      } else {
        // Production: идем напрямую в Directus с запросом суточного токена
        response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
          email: tempEmail,
          password: tempPassword,
          mode: 'json'
        });

        // Ответ /auth/login целиком — это access_token и refresh_token в логе.
        log.debug('[login] Directus auth response received:', response.status);

        token = response.data.data.access_token;

        // КРИТИЧНО: Directus /auth/login НЕ возвращает данные пользователя
        // Нужно отдельно запросить /users/me с полученным токеном
        const userResponse = await axios.get(`${DIRECTUS_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        user = userResponse.data.data;
      }

      if (token && user) {
        ctx.session.token = token;
        ctx.session.email = user.email;
        ctx.session.userId = user.id;
        ctx.session.firstName = user.first_name;
        ctx.session.lastName = user.last_name;

        // Получаем refreshToken из ответа для сохранения
        // КРИТИЧНО: В production refresh_token в response.data.data.refresh_token
        const refreshToken = isDev ? response.data.refresh_token : response.data.data.refresh_token;
        log.debug('[LOGIN-DEBUG] Extracted refresh_token:', refreshToken ? 'YES' : 'NO');
        if (refreshToken) {
          ctx.session.refreshToken = refreshToken;

          // КРИТИЧНО: Кешируем токен в ОБОИХ менеджерах для автообновления
          // В production expires в response.data.data.expires (в миллисекундах)
          const expiresInMs = isDev ? response.data.expires : response.data.data.expires;
          const expiresIn = expiresInMs ? Math.floor(expiresInMs / 1000) : 900; // Конвертируем в секунды, по умолчанию 15 минут
          const { directusApiManager } = await import('../directus.js');
          const { directusAuthManager } = await import('../services/directus-auth-manager.js');

          // 1. DirectusApiManager (для обратной совместимости)
          directusApiManager.cacheAuthToken(user.id, token, expiresIn, refreshToken);

          // 2. КРИТИЧНО: DirectusAuthManager.upsertSession() для proactive refresh
          // Этот вызов добавляет сессию в sessionCache, откуда refreshExpiringSessions()
          // автоматически обновит токены за 3 минуты до истечения (каждые 2 мин проверка)
          directusAuthManager.upsertSession({
            userId: user.id,
            token,
            refreshToken,
            user: {
              id: user.id,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              role: user.role
            }
          });

          log.debug(`[auth] token cached in both managers for user ${user.id} (proactive refresh active)`);
        }

        // КРИТИЧНО: Обновляем in-memory кэш сессий СРАЗУ после авторизации
        const chatId = ctx.chat?.id;
        if (chatId) {
          this.sessions.set(chatId, {
            ...ctx.session,
            token,
            refreshToken,
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
          });
          log.debug(`[auth] token refreshed for user ${user.id} in Telegram bot`);

          // Сохраняем сессию в БД
          await this.saveSessionToDB(chatId, ctx.session);
        }

        const displayName = user.first_name ?
          `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}` :
          user.email;

        await ctx.reply(`✅ Вы успешно авторизованы!\n\nДобро пожаловать, ${displayName}!`);
        await this.handleMenu(ctx);
      } else {
        await ctx.reply('❌ Ошибка авторизации. Проверьте данные и попробуйте снова: /login');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
      await ctx.reply(`❌ Ошибка входа: ${errorMsg}\n\nПопробуйте снова: /login`);
    }
  }

  private async createCampaign(ctx: BotContext, name: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      await ctx.reply('⏳ Создаю кампанию...');

      const response = await axios.post(
        `${API_BASE_URL}/api/campaigns`,
        {
          name: name,
          description: `Создано через Telegram бота`,
          status: 'active'
        },
        {
          headers
        }
      );

      const campaign = response.data.data || response.data;

      await ctx.replyWithHTML(`✅ <b>Кампания создана!</b>

<b>Название:</b> ${campaign.name || name}
<b>ID:</b> <code>${campaign.id}</code>

Теперь вы можете генерировать контент для этой кампании.`);
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      await ctx.reply(`❌ Ошибка при создании кампании: ${error.message}`);
    }
  }

  private async generateContent(ctx: BotContext, prompt: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      await ctx.reply('⏳ Генерирую контент...');

      const response = await axios.post(
        `${API_BASE_URL}/api/generate-content`,
        {
          prompt: prompt,
          model: 'gemini',
          language: 'ru'
        },
        {
          headers
        }
      );

      const content = response.data.content || response.data.text || response.data;

      // Сохраняем сгенерированный контент в сессии
      ctx.session.lastGeneratedContent = content;

      // КРИТИЧНО: Явно сохраняем сессию в БД, иначе lastGeneratedContent потеряется
      log.debug('[content-gen] saving lastGeneratedContent to DB, length:', content.length);
      if (ctx.chat?.id) {
        await this.saveSessionToDB(ctx.chat.id, ctx.session);
      }
      log.debug('[CONTENT-GEN] Session saved to DB');

      // Используем sendLongMessage для обработки длинных текстов
      await this.sendLongMessage(ctx, `✅ <b>Контент сгенерирован:</b>\n\n${content}`, 'HTML');

      // Добавляем кнопки для сохранения контента
      const buttons = [];

      // Если есть текущая кампания - добавляем кнопку сохранения в неё
      if (ctx.session.currentCampaignId) {
        buttons.push([Markup.button.callback('💾 Сохранить в текущую кампанию', 'save_generated_to_current')]);
      }

      // Кнопка выбора другой кампании
      buttons.push([Markup.button.callback('📋 Выбрать кампанию', 'save_generated_select_campaign')]);
      buttons.push([Markup.button.callback('❌ Отменить', 'action_main_menu')]);

      await ctx.reply('Что делать с этим контентом?', Markup.inlineKeyboard(buttons));
    } catch (error: any) {
      console.error('Error generating content:', error);
      await ctx.reply(`❌ Ошибка при генерации контента: ${error.message}`);
    }
  }

  /**
   * Сохраняет сгенерированный контент в указанную кампанию
   */
  private async saveGeneratedContentToCampaign(ctx: BotContext, campaignId: string) {
    try {
      log.debug('[SAVE-CONTENT] Starting content save process');
      log.debug('[save-content] Campaign ID:', campaignId);
      log.debug('[save-content] Has lastGeneratedContent:', !!ctx.session.lastGeneratedContent);
      log.debug('[save-content] Content length:', ctx.session.lastGeneratedContent?.length);

      if (!ctx.session.lastGeneratedContent) {
        log.debug('[SAVE-CONTENT] ERROR: No content in session');
        await ctx.reply('❌ Ошибка: нет сгенерированного контента для сохранения');
        return;
      }

      await ctx.reply('⏳ Сохраняю контент в кампанию...');

      // Используем Directus proxy для создания поста
      const postData = {
        campaign_id: campaignId,
        text: ctx.session.lastGeneratedContent,
        status: 'draft',
        content_type: 'post'
      };

      log.debug('[SAVE-CONTENT] Sending request to Directus proxy');
      log.debug('[save-content] Post data:', JSON.stringify(postData, null, 2));

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        log.debug('[SAVE-CONTENT] ERROR: Failed to get auth headers');
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/directus/items/campaign_content`,
        postData,
        {
          headers
        }
      );

      log.debug('[save-content] Response status:', response.status);
      log.debug('[save-content] Response data:', JSON.stringify(response.data, null, 2));

      const content = response.data.data || response.data;

      if (!content || !content.id) {
        log.debug('[SAVE-CONTENT] ERROR: No content ID in response');
        throw new Error('Не удалось получить ID созданного поста');
      }

      log.debug('[save-content] Successfully created post with ID:', content.id);

      // Очищаем сохраненный контент после успешного сохранения
      const savedContent = ctx.session.lastGeneratedContent;
      ctx.session.lastGeneratedContent = undefined;

      log.debug('[SAVE-CONTENT] Cleared lastGeneratedContent from session');

      await ctx.replyWithHTML(`✅ <b>Контент сохранён как черновик!</b>\n\n<b>ID:</b> <code>${content.id}</code>\n\nВы можете найти его в списке постов кампании.`);
      await this.handleMenu(ctx);
    } catch (error: any) {
      console.error('[SAVE-CONTENT] Error saving generated content:', error);
      console.error('[SAVE-CONTENT] Error response:', error.response?.data);
      await ctx.reply(`❌ Ошибка при сохранении контента: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }

  /**
   * Показывает список кампаний для выбора куда сохранить контент
   */
  private async showCampaignListForSaving(ctx: BotContext) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaigns`, {
        headers
      });

      const campaigns = response.data.data || response.data;

      if (!campaigns || campaigns.length === 0) {
        await ctx.reply('У вас пока нет кампаний. Создайте кампанию с помощью /new');
        return;
      }

      const buttons = campaigns.map((campaign: any) => [
        Markup.button.callback(
          `📁 ${campaign.name || campaign.title}`,
          `save_generated_to_campaign_${campaign.id}`
        )
      ]);

      buttons.push([Markup.button.callback('❌ Отменить', 'action_main_menu')]);

      await ctx.reply(
        '📋 <b>Выберите кампанию для сохранения контента:</b>',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (error: any) {
      console.error('Error fetching campaigns:', error);
      await ctx.reply(`❌ Ошибка при загрузке кампаний: ${error.message}`);
    }
  }

  private async improvePromptForImageGeneration(ctx: BotContext, userPrompt: string): Promise<string> {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        // В случае ошибки просто возвращаем оригинальный промпт
        return userPrompt;
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/generate-content`,
        {
          prompt: `You are an expert at creating prompts for AI image generation (Stable Diffusion, FLUX, etc).

Convert the user's simple request into a detailed, high-quality English prompt for image generation.

Include:
- Main subject and action
- Art style (photorealistic, digital art, oil painting, etc.)
- Composition and framing
- Lighting (soft light, dramatic, golden hour, etc.)
- Color palette
- Quality keywords (masterpiece, high quality, detailed, 8k, etc.)

User's request: "${userPrompt}"

Return ONLY the improved English prompt, nothing else. No explanations.`,
          model: 'gemini',
          language: 'en'
        },
        {
          headers
        }
      );

      const improvedPrompt = response.data.content || response.data.text || userPrompt;
      return improvedPrompt.trim();
    } catch (error: any) {
      console.error('Error improving prompt:', error);
      // Возвращаем оригинальный текст в случае ошибки
      return userPrompt;
    }
  }

  private async generateImage(ctx: BotContext, prompt: string) {
    try {
      const model = ctx.session.selectedImageModel || 'schnell';

      // Шаг 1: Генерация английского промпта
      await ctx.reply('⏳ Генерирую английский промпт для изображения...');

      // Улучшаем промпт для генерации изображения
      const improvedPrompt = await this.improvePromptForImageGeneration(ctx, prompt);
      log.debug('[image-gen] Original prompt:', prompt);
      log.debug('[image-gen] Improved prompt:', improvedPrompt);
      log.debug('[image-gen] Selected model:', model);

      // Шаг 2: Показываем сгенерированный промпт пользователю
      if (improvedPrompt && improvedPrompt !== prompt) {
        await ctx.reply(`✅ <b>Сгенерирован английский промпт:</b>\n\n${improvedPrompt}`, { parse_mode: 'HTML' });
      }

      // Шаг 3: Генерация изображения
      await ctx.reply('⏳ Генерирую изображение... Это может занять до минуты.');

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/generate-image`,
        {
          prompt: improvedPrompt,
          modelName: model,
          width: 1024,
          height: 1024,
          numImages: 1,
          provider: 'fal-ai'
        },
        {
          headers,
          timeout: 120000
        }
      );

      // Логируем полный ответ API для отладки
      log.debug('[image-gen] API response:', JSON.stringify(response.data, null, 2));

      // КРИТИЧНО: FAL.AI возвращает массив URL в data: ["https://..."]
      const imageUrl = response.data?.data?.[0] || // FAL.AI формат: {data: ["url"]}
        response.data?.data?.images?.[0]?.url ||
        response.data?.data?.imageUrl ||
        response.data?.data?.images?.[0] ||
        response.data?.image_urls?.[0] ||
        response.data?.images?.[0]?.url ||
        response.data?.image_url ||
        response.data?.url;

      if (imageUrl) {
        // Сохраняем изображение и промпт в сессии для дальнейшего использования
        ctx.session.uploadedPhotoUrl = imageUrl;
        ctx.session.uploadedPhotoText = prompt;

        // Отправляем изображение с подписью и ссылкой
        await ctx.replyWithPhoto({ url: imageUrl }, {
          caption: `🎨 <b>Изображение создано по запросу:</b>\n${prompt}\n\n🔗 <a href="${imageUrl}">Прямая ссылка на изображение</a>`,
          parse_mode: 'HTML'
        });

        // Показываем кнопки для действий с изображением
        const actionButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback('💾 Сохранить в кампанию', 'photo_save_to_campaign')
          ],
          [
            Markup.button.callback('✍️ Изменить название', 'photo_add_text')
          ],
          [
            Markup.button.callback('❌ Отменить', 'photo_cancel')
          ]
        ]);

        await ctx.reply('📝 Название контента (можно изменить):\n' + prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '') + '\n\nЧто делать с изображением?', actionButtons);

        // Очищаем выбранную модель после успешной генерации
        ctx.session.selectedImageModel = undefined;
      } else {
        console.error('[TG-BOT] Failed to extract image URL from response:', response.data);
        await ctx.reply('✅ Изображение сгенерировано, но не удалось получить URL\n\n📋 Полный ответ сервера:\n' + JSON.stringify(response.data, null, 2).substring(0, 500));
      }
    } catch (error: any) {
      console.error('Error generating image:', error);
      await ctx.reply(`❌ Ошибка при генерации изображения: ${error.message}`);
      // Очищаем выбранную модель в случае ошибки
      ctx.session.selectedImageModel = undefined;
    }
  }

  private async askAssistant(ctx: BotContext, message: string) {
    try {
      await ctx.reply('⏳ AI ассистент обрабатывает ваш запрос...');

      const userId = ctx.session.userId;
      const chatId = ctx.chat?.id;

      if (!userId) {
        return ctx.reply('❌ Ошибка: не удалось определить пользователя');
      }

      // КРИТИЧНО: Загружаем историю диалога из БД для контекста
      const { aiConversationStorage } = await import('../services/ai-conversation-storage');
      const conversationHistory = await aiConversationStorage.loadHistory(userId, chatId, 9); // Загружаем 9, добавим текущее = 10

      // Сохраняем сообщение пользователя
      try {
        await aiConversationStorage.saveMessage({
          user_id: userId,
          chat_id: chatId,
          campaign_id: ctx.session.currentCampaignId,
          role: 'user',
          content: message,
          timestamp: new Date()
        });
      } catch (saveError) {
        console.error('⚠️ Failed to save user message to history:', saveError);
        // Продолжаем работу, но логируем ошибку
      }

      // Добавляем текущее сообщение в историю для AI
      const fullHistory = [
        ...aiConversationStorage.formatHistoryForAI(conversationHistory),
        { role: 'user' as const, content: message, timestamp: new Date() }
      ];

      // Используем автономный AI API
      const requestBody: any = {
        message: message,
        context: 'telegram_bot',
        chatHistory: fullHistory
      };

      // Добавляем campaignId если работаем в контексте кампании
      if (ctx.session.currentCampaignId) {
        requestBody.campaignId = ctx.session.currentCampaignId;
      }

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/autonomous-ai/execute`,
        requestBody,
        {
          headers,
          timeout: 180000 // 3 минуты для выполнения сложных операций
        }
      );

      const aiResponse = response.data;
      const reply = aiResponse.response || aiResponse.message || 'Задача выполнена';

      // Сохраняем ответ AI в историю
      try {
        await aiConversationStorage.saveMessage({
          user_id: userId,
          chat_id: chatId,
          campaign_id: ctx.session.currentCampaignId,
          role: 'assistant',
          content: reply,
          timestamp: new Date(),
          metadata: aiResponse.data ? { tools: aiResponse.data } : undefined
        });
      } catch (saveError) {
        console.error('⚠️ Failed to save AI response to history:', saveError);
        // Продолжаем работу, но логируем ошибку
      }

      // Используем sendLongMessage для обработки длинных ответов
      await this.sendLongMessage(ctx, `🤖 <b>AI Ассистент:</b>\n\n${reply}`, 'HTML');

      // Если есть интерактивные элементы (кнопки), показываем их
      if (aiResponse.interactive?.buttons && Array.isArray(aiResponse.interactive.buttons)) {
        const buttons = aiResponse.interactive.buttons.map((btn: any) => {
          return Markup.button.callback(btn.text, `ai_action_${btn.action}`);
        });

        // Разбиваем кнопки на ряды по 2
        const buttonRows = [];
        for (let i = 0; i < buttons.length; i += 2) {
          buttonRows.push(buttons.slice(i, i + 2));
        }

        const interactiveButtons = Markup.inlineKeyboard(buttonRows);
        await ctx.reply('Выберите действие:', interactiveButtons);
      } else {
        // Показываем стандартные кнопки продолжения работы
        const actionButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Продолжить диалог', 'action_continue_chat'),
            Markup.button.callback('📱 Главное меню', 'action_main_menu')
          ]
        ]);
        await ctx.reply('Что бы вы хотели сделать дальше?', actionButtons);
      }
    } catch (error: any) {
      console.error('Error asking assistant:', error);
      const errorMsg = error.response?.data?.message || error.message;
      await ctx.reply(`❌ Ошибка при обращении к ассистенту: ${errorMsg}`);
    }
  }

  private async handleAutonomousStart(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    if (!ctx.session.currentCampaignId) {
      return ctx.reply('❌ Для запуска автономного режима откройте кампанию и используйте команду /autonomous');
    }

    await this.askAssistant(ctx, 'Запусти автономный режим для этой кампании');
  }

  private async handleAutonomousStop(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    if (!ctx.session.currentCampaignId) {
      return ctx.reply('❌ Укажите кампанию для остановки автономного режима');
    }

    await this.askAssistant(ctx, 'Останови автономный режим для этой кампании');
  }

  private async handleAutonomousStatus(ctx: BotContext) {
    if (!this.checkAuth(ctx)) return;

    if (!ctx.session.currentCampaignId) {
      return ctx.reply('❌ Укажите кампанию для проверки статуса автономного режима');
    }

    await this.askAssistant(ctx, 'Покажи статус автономного режима для этой кампании');
  }

  private async showCampaignMenu(ctx: BotContext, campaignId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaigns/${campaignId}`, {
        headers
      });

      const campaign = response.data.data || response.data;

      // Сохраняем ID текущей кампании в сессии
      ctx.session.currentCampaignId = campaignId;

      const menu = Markup.inlineKeyboard([
        [
          Markup.button.callback('📊 Информация', `campaign_info_${campaignId}`),
          Markup.button.callback('📝 Посты', `campaign_content_${campaignId}`)
        ],
        [
          Markup.button.callback('📊 Опубликованные посты', `published_campaign_${campaignId}`)
        ],
        [
          Markup.button.callback('✍️ Генерировать контент', `campaign_generate_content_${campaignId}`),
          Markup.button.callback('🎨 Создать изображение', `campaign_generate_image_${campaignId}`)
        ],
        [
          Markup.button.callback('📸 Загрузить фото', `campaign_upload_photo_${campaignId}`),
          Markup.button.callback('🤖 AI Ассистент', `campaign_assistant_${campaignId}`)
        ],
        [
          Markup.button.callback('◀️ Назад к списку', 'action_show_campaigns'),
          Markup.button.callback('📱 Главное меню', 'action_main_menu')
        ]
      ]);

      await ctx.reply(
        `📱 <b>Кампания: ${campaign.name || campaign.title}</b>\n\nВыберите действие:`,
        {
          parse_mode: 'HTML',
          ...menu
        }
      );
    } catch (error: any) {
      console.error('Error showing campaign menu:', error);
      await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
  }

  private async showCampaignInfo(ctx: BotContext, campaignId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaigns/${campaignId}`, {
        headers
      });

      const campaign = response.data.data || response.data;

      let info = `📊 <b>Информация о кампании</b>\n\n`;
      info += `<b>Название:</b> ${campaign.name || campaign.title}\n`;
      info += `<b>ID:</b> <code>${campaign.id}</code>\n`;
      if (campaign.description) {
        info += `<b>Описание:</b> ${campaign.description}\n`;
      }
      if (campaign.status) {
        info += `<b>Статус:</b> ${campaign.status}\n`;
      }

      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Назад', `campaign_${campaignId}`)]
      ]);

      await ctx.replyWithHTML(info, backButton);
    } catch (error: any) {
      console.error('Error showing campaign info:', error);
      await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
  }

  private async generateContentForCampaign(ctx: BotContext, prompt: string, campaignId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      await ctx.reply('⏳ Генерирую контент для кампании...');

      const response = await axios.post(
        `${API_BASE_URL}/api/generate-content`,
        {
          prompt: prompt,
          model: 'gemini',
          language: 'ru',
          campaignId: campaignId
        },
        {
          headers
        }
      );

      const content = response.data.content || response.data.text || response.data;

      // Сохраняем контент в сессию для возможности сохранения
      ctx.session.lastGeneratedContent = content;
      ctx.session.lastGeneratedCampaignId = campaignId;

      // КРИТИЧНО: Явно сохраняем сессию в БД, иначе данные потеряются при редактировании
      log.debug('[content-gen] saving session to DB with campaignId:', campaignId);
      log.debug('[content-gen] Content length:', content.length);
      if (ctx.chat?.id) {
        await this.saveSessionToDB(ctx.chat.id, ctx.session);
      }
      log.debug('[CONTENT-GEN] Session saved to DB successfully');

      // Используем sendLongMessage для обработки длинных текстов (автоматическая разбивка)
      await this.sendLongMessage(ctx, `✅ <b>Контент сгенерирован:</b>\n\n${content}`, 'HTML');

      const actionButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('💾 Сохранить пост', `save_generated_content`),
          Markup.button.callback('✏️ Редактировать', `edit_generated_content`)
        ],
        [
          Markup.button.callback('🔄 Сгенерировать ещё', `campaign_generate_content_${campaignId}`),
          Markup.button.callback('🎨 Создать изображение', `campaign_generate_image_${campaignId}`)
        ],
        [
          Markup.button.callback('◀️ К кампании', `campaign_${campaignId}`),
          Markup.button.callback('📱 Главное меню', 'action_main_menu')
        ]
      ]);

      await ctx.reply('Что делаем дальше?', actionButtons);
    } catch (error: any) {
      console.error('Error generating content for campaign:', error);
      await ctx.reply(`❌ Ошибка при генерации контента: ${error.message}`);
    }
  }

  private async generateImageForCampaign(ctx: BotContext, prompt: string, campaignId: string) {
    try {
      const model = ctx.session.selectedImageModel || 'schnell';

      // Шаг 1: Генерация английского промпта
      await ctx.reply('⏳ Генерирую английский промпт для изображения...');

      // Улучшаем промпт для генерации изображения
      const improvedPrompt = await this.improvePromptForImageGeneration(ctx, prompt);
      log.debug('[image-gen] Original prompt:', prompt);
      log.debug('[image-gen] Improved prompt:', improvedPrompt);
      log.debug('[image-gen] Selected model:', model);

      // Шаг 2: Показываем сгенерированный промпт пользователю
      if (improvedPrompt && improvedPrompt !== prompt) {
        await ctx.reply(`✅ <b>Сгенерирован английский промпт:</b>\n\n${improvedPrompt}`, { parse_mode: 'HTML' });
      }

      // Шаг 3: Генерация изображения
      await ctx.reply('⏳ Генерирую изображение... Это может занять до минуты.');

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      // Генерируем изображение
      const imageResponse = await axios.post(
        `${API_BASE_URL}/api/generate-image`,
        {
          prompt: improvedPrompt,
          modelName: model,
          width: 1024,
          height: 1024,
          numImages: 1,
          provider: 'fal-ai'
        },
        {
          headers,
          timeout: 120000
        }
      );

      // Логируем полный ответ API для отладки
      log.debug('[image-gen] API response for campaign:', JSON.stringify(imageResponse.data, null, 2));

      // КРИТИЧНО: FAL.AI возвращает массив URL в data: ["https://..."]
      const imageUrl = imageResponse.data?.data?.[0] || // FAL.AI формат: {data: ["url"]}
        imageResponse.data?.data?.images?.[0]?.url ||
        imageResponse.data?.data?.imageUrl ||
        imageResponse.data?.data?.images?.[0] ||
        imageResponse.data?.image_urls?.[0] ||
        imageResponse.data?.images?.[0]?.url ||
        imageResponse.data?.image_url ||
        imageResponse.data?.url;

      if (imageUrl) {
        // Создаем контент с изображением
        const contentResponse = await axios.post(
          `${API_BASE_URL}/api/campaign-content`,
          {
            campaign_id: campaignId,
            content: prompt,
            status: 'draft',
            content_type: 'photo',
            media_url: imageUrl
          },
          { headers }
        );

        const savedContent = contentResponse.data.data || contentResponse.data;

        // Отправляем изображение с подписью и ссылкой
        await ctx.replyWithPhoto({ url: imageUrl }, {
          caption: `🎨 <b>Изображение создано и сохранено как контент</b>\n\n${prompt}\n\n🔗 <a href="${imageUrl}">Прямая ссылка на изображение</a>`,
          parse_mode: 'HTML'
        });

        const actionButtons = Markup.inlineKeyboard([
          [
            Markup.button.callback('📝 Посмотреть пост', `content_view_${savedContent.id}`),
            Markup.button.callback('📤 Опубликовать', `content_publish_${savedContent.id}`)
          ],
          [
            Markup.button.callback('🔄 Ещё изображение', `campaign_generate_image_${campaignId}`),
            Markup.button.callback('✍️ Генерировать контент', `campaign_generate_content_${campaignId}`)
          ],
          [
            Markup.button.callback('◀️ К кампании', `campaign_${campaignId}`),
            Markup.button.callback('📱 Главное меню', 'action_main_menu')
          ]
        ]);

        await ctx.reply('Что делаем дальше?', actionButtons);

        // Очищаем выбранную модель после успешной генерации
        ctx.session.selectedImageModel = undefined;
      } else {
        console.error('[TG-BOT] Failed to extract image URL from campaign response:', imageResponse.data);
        await ctx.reply('✅ Изображение сгенерировано, но не удалось получить URL\n\n📋 Полный ответ сервера:\n' + JSON.stringify(imageResponse.data, null, 2).substring(0, 500));
      }
    } catch (error: any) {
      console.error('Error generating image for campaign:', error);
      await ctx.reply(`❌ Ошибка при генерации изображения: ${error.message}`);
      // Очищаем выбранную модель в случае ошибки
      ctx.session.selectedImageModel = undefined;
    }
  }

  private async showCampaignContent(ctx: BotContext, campaignId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaign-content`, {
        headers,
        params: { campaignId, page: 1, limit: 10 }
      });

      const content = response.data.data || response.data.content || [];

      if (!content || content.length === 0) {
        const backButton = Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', `campaign_${campaignId}`)]
        ]);
        return ctx.reply('📝 В этой кампании пока нет постов', backButton);
      }

      const buttons = content.slice(0, 10).map((item: any) => {
        const preview = item.text?.substring(0, 40) || item.title?.substring(0, 40) || 'Без текста';
        return [Markup.button.callback(`📄 ${preview}...`, `content_view_${item.id}`)];
      });

      buttons.push([Markup.button.callback('◀️ Назад к кампании', `campaign_${campaignId}`)]);

      await ctx.reply(
        `📝 <b>Посты кампании</b>\n\nНайдено постов: ${content.length}\nВыберите пост для просмотра:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (error: any) {
      console.error('Error showing campaign content:', error);
      await ctx.reply(`❌ Ошибка при получении постов: ${error.message}`);
    }
  }

  private async showContentDetail(ctx: BotContext, contentId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaign-content/${contentId}`, {
        headers
      });

      const content = response.data.data || response.data;

      let message = `📄 <b>Пост #${contentId.substring(0, 8)}</b>\n\n`;

      if (content.title) {
        message += `<b>Заголовок:</b> ${content.title}\n\n`;
      }

      if (content.text) {
        const textPreview = content.text.length > 500
          ? content.text.substring(0, 500) + '...'
          : content.text;
        message += `<b>Текст:</b>\n${textPreview}\n\n`;
      }

      if (content.status) {
        message += `<b>Статус:</b> ${content.status}\n`;
      }

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback('📤 Опубликовать', `content_publish_${contentId}`),
          Markup.button.callback('✏️ Редактировать', `content_edit_${contentId}`)
        ],
        [
          Markup.button.callback('◀️ К списку постов', `campaign_content_${content.campaign_id || ctx.session.currentCampaignId}`)
        ]
      ]);

      await ctx.replyWithHTML(message, buttons);
    } catch (error: any) {
      console.error('Error showing content detail:', error);
      await ctx.reply(`❌ Ошибка при получении поста: ${error.message}`);
    }
  }

  private async showPublishedPostDetail(ctx: BotContext, contentId: string) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaign-content/${contentId}`, {
        headers
      });

      const content = response.data.data || response.data;

      // Проверяем что пост действительно опубликован по статусу
      if (content.status !== 'published') {
        return ctx.reply('❌ Этот пост не опубликован');
      }

      const platforms = content.social_platforms || content.socialPlatforms || {};
      const publishedPlatforms = Object.entries(platforms)
        .filter(([_, data]: [string, any]) => data.status === 'published');

      // Функция для очистки HTML от неподдерживаемых Telegram тегов
      const cleanHtmlForTelegram = (html: string): string => {
        if (!html) return '';
        // Удаляем все HTML теги, оставляя только текст
        return html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim();
      };

      let message = `📊 <b>Опубликованный пост</b>\n\n`;

      if (content.title) {
        message += `<b>Заголовок:</b> ${cleanHtmlForTelegram(content.title)}\n\n`;
      }

      if (content.text || content.content) {
        const text = cleanHtmlForTelegram(content.text || content.content);
        const textPreview = text.length > 300
          ? text.substring(0, 300) + '...'
          : text;
        message += `<b>Текст:</b>\n${textPreview}\n\n`;
      }

      message += `<b>Опубликовано на:</b>\n`;
      for (const [platformName, platformData] of publishedPlatforms) {
        const data = platformData as any;
        const platformIcons: Record<string, string> = {
          facebook: '📘 Facebook',
          instagram: '📷 Instagram',
          vk: '🔷 VK',
          telegram: '✈️ Telegram',
          youtube: '▶️ YouTube'
        };
        const displayName = platformIcons[platformName] || platformName;
        message += `• ${displayName}`;

        if (data.publishedAt) {
          const date = new Date(data.publishedAt);
          message += ` (${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`;
        }

        if (data.postUrl) {
          message += `\n  🔗 <a href="${data.postUrl}">Открыть пост</a>`;
        }

        message += '\n';
      }

      const buttons = [];

      // Добавляем ссылки на посты в соцсетях
      for (const [platformName, platformData] of publishedPlatforms) {
        const data = platformData as any;
        if (data.postUrl) {
          const platformIcons: Record<string, string> = {
            facebook: '📘',
            instagram: '📷',
            vk: '🔷',
            telegram: '✈️',
            youtube: '▶️'
          };
          const icon = platformIcons[platformName] || '🔗';
          buttons.push([Markup.button.url(`${icon} Открыть в ${platformName}`, data.postUrl)]);
        }
      }

      buttons.push([
        Markup.button.callback('◀️ Назад к кампании', `published_campaign_${content.campaign_id || content.campaignId}`)
      ]);

      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (error: any) {
      console.error('Error showing published post detail:', error);
      await ctx.reply(`❌ Ошибка при получении поста: ${error.message}`);
    }
  }

  private async publishContent(ctx: BotContext, contentId: string) {
    try {
      // Показываем выбор платформ
      const platformButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Facebook', `publish_platform_facebook_${contentId}`),
          Markup.button.callback('✅ Instagram', `publish_platform_instagram_${contentId}`)
        ],
        [
          Markup.button.callback('✅ VK', `publish_platform_vk_${contentId}`),
          Markup.button.callback('✅ Telegram', `publish_platform_telegram_${contentId}`)
        ],
        [
          Markup.button.callback('✅ YouTube', `publish_platform_youtube_${contentId}`)
        ],
        [
          Markup.button.callback('📤 Опубликовать везде', `publish_all_${contentId}`)
        ],
        [
          Markup.button.callback('◀️ Отмена', `content_view_${contentId}`)
        ]
      ]);

      await ctx.reply('🎯 Выберите платформы для публикации:', platformButtons);
    } catch (error: any) {
      console.error('Error showing publish options:', error);
      await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
  }

  private async actuallyPublishContent(ctx: BotContext, contentId: string, platforms: string[]) {
    try {
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      await ctx.reply('⏳ Публикую пост...');

      const platformsObj: Record<string, boolean> = {};
      platforms.forEach(p => { platformsObj[p] = true; });

      log.debug(`[publish] sending request: contentId=${contentId}, platforms=${platforms.join(',')}`);

      const response = await axios.post(
        `${API_BASE_URL}/api/publish/now`,
        { contentId, platforms: platformsObj },
        { headers, timeout: 60000 }
      );

      log.debug('[publish] response status:', response.status);

      const data = response.data;

      if (data.results && Array.isArray(data.results)) {
        const successPlatforms: string[] = [];
        const failedPlatforms: string[] = [];

        for (const result of data.results) {
          if (result.success) {
            successPlatforms.push(result.platform);
          } else {
            failedPlatforms.push(`${result.platform}: ${result.error || 'ошибка'}`);
          }
        }

        if (successPlatforms.length > 0) {
          await ctx.reply(`✅ Отправлено на публикацию: ${successPlatforms.join(', ')}`);
        }
        if (failedPlatforms.length > 0) {
          await ctx.reply(`⚠️ Ошибки:\n${failedPlatforms.join('\n')}`);
        }
      } else if (data.success) {
        await ctx.reply(`✅ Отправлено на публикацию: ${platforms.join(', ')}`);
      } else if (data.message) {
        await ctx.reply(`📤 ${data.message}`);
      } else {
        await ctx.reply(`✅ Запрос на публикацию отправлен в: ${platforms.join(', ')}`);
      }

      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Назад к посту', `content_view_${contentId}`)]
      ]);

      await ctx.reply('Что делать дальше?', backButton);
    } catch (error: any) {
      console.error('[TG-BOT-PUBLISH] Error:', error.response?.status, error.response?.data || error.message);

      if (error.response?.status === 409) {
        const msg = error.response?.data?.message || 'Контент уже опубликован на выбранных платформах';
        await ctx.reply(`⚠️ ${msg}`);
      } else if (error.response?.data?.error) {
        await ctx.reply(`❌ Ошибка: ${error.response.data.error}`);
      } else {
        await ctx.reply(`❌ Ошибка при публикации: ${error.message}`);
      }
    }
  }

  private async saveGeneratedContent(ctx: BotContext) {
    try {
      log.debug('[SAVE-CONTENT] Starting save process');
      log.debug('[save-content] lastGeneratedCampaignId:', ctx.session.lastGeneratedCampaignId);
      log.debug('[save-content] Has content:', !!ctx.session.lastGeneratedContent);

      if (!ctx.session.lastGeneratedContent || !ctx.session.lastGeneratedCampaignId) {
        log.debug('[SAVE-CONTENT] ERROR: Missing content or campaign ID');
        return ctx.reply('❌ Нет сгенерированного контента для сохранения');
      }

      await ctx.reply('⏳ Сохраняю пост...');

      const postData = {
        campaign_id: ctx.session.lastGeneratedCampaignId,
        text: ctx.session.lastGeneratedContent,
        status: 'draft',
        content_type: 'text'
      };

      log.debug('[save-content] Sending to Directus API:', JSON.stringify(postData, null, 2));

      // КРИТИЧНО: Используем getAuthHeaders для гарантированно свежего токена
      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        log.debug('[SAVE-CONTENT] ERROR: Failed to get auth headers');
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/directus/items/campaign_content`,
        postData,
        { headers }
      );

      log.debug('[save-content] Response status:', response.status);
      log.debug('[save-content] Response data:', JSON.stringify(response.data, null, 2));

      const savedContent = response.data.data || response.data;

      await ctx.reply(`✅ Пост сохранен в черновиках!`);

      const actionButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Посмотреть пост', `content_view_${savedContent.id}`),
          Markup.button.callback('📤 Опубликовать', `content_publish_${savedContent.id}`)
        ],
        [
          Markup.button.callback('📅 Запланировать', `content_schedule_${savedContent.id}`)
        ],
        [
          Markup.button.callback('◀️ К кампании', `campaign_${ctx.session.lastGeneratedCampaignId}`),
          Markup.button.callback('📱 Главное меню', 'action_main_menu')
        ]
      ]);

      await ctx.reply('Что делать дальше?', actionButtons);

      // Очищаем сохраненный контент из сессии
      ctx.session.lastGeneratedContent = undefined;
      ctx.session.lastGeneratedCampaignId = undefined;
    } catch (error: any) {
      console.error('Error saving content:', error);
      await ctx.reply(`❌ Ошибка при сохранении: ${error.message}`);
    }
  }

  private async startScheduling(ctx: BotContext, contentId: string) {
    try {
      // Сбрасываем предыдущее состояние
      ctx.session.awaitingInput = undefined;
      ctx.session.schedulingContentId = contentId;
      ctx.session.schedulingStep = 'date';
      ctx.session.schedulingDate = undefined;
      ctx.session.schedulingTime = undefined;
      ctx.session.schedulingPlatforms = undefined;

      await ctx.reply('📅 Планирование публикации\n\n⚠️ <b>Важно:</b> Все время указывается в UTC (GMT+0)\nДля вашего местного времени учитывайте разницу часовых поясов.\n\n📆 Введите дату в формате ДД.ММ.ГГГГ\nНапример: 15.11.2025', {
        parse_mode: 'HTML'
      });
    } catch (error: any) {
      console.error('Error starting scheduling:', error);
      await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
  }

  private async handleSchedulingPlatforms(ctx: BotContext) {
    try {
      if (!ctx.session.schedulingContentId) {
        return ctx.reply('❌ Ошибка: контент не найден');
      }

      const contentId = ctx.session.schedulingContentId;
      const platformButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Facebook', `schedule_platform_facebook_${contentId}`),
          Markup.button.callback('✅ Instagram', `schedule_platform_instagram_${contentId}`)
        ],
        [
          Markup.button.callback('✅ VK', `schedule_platform_vk_${contentId}`),
          Markup.button.callback('✅ Telegram', `schedule_platform_telegram_${contentId}`)
        ],
        [
          Markup.button.callback('✅ YouTube', `schedule_platform_youtube_${contentId}`)
        ],
        [
          Markup.button.callback('📤 Запланировать везде', `schedule_all_${contentId}`)
        ],
        [
          Markup.button.callback('◀️ Отмена', `content_view_${contentId}`)
        ]
      ]);

      await ctx.reply('🎯 Выберите платформы для планирования:', platformButtons);
    } catch (error: any) {
      console.error('Error showing scheduling platforms:', error);
      await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
  }

  private async actuallyScheduleContent(ctx: BotContext, contentId: string, platforms: string[]) {
    try {
      const { schedulingDate, schedulingTime } = ctx.session;

      if (!schedulingDate || !schedulingTime) {
        return ctx.reply('❌ Ошибка: не указана дата или время');
      }

      // Парсим дату из формата ДД.ММ.ГГГГ
      const [day, month, year] = schedulingDate.split('.');
      // Парсим время из формата ЧЧ:ММ
      const [hours, minutes] = schedulingTime.split(':');

      // Создаём ISO строку в UTC (как указано в подсказке пользователю)
      const scheduledDateTime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00Z`;

      await ctx.reply('⏳ Планирую публикацию...');

      // Формируем объект socialPlatforms для API /api/direct-schedule/:contentId
      const socialPlatforms: Record<string, any> = {};
      platforms.forEach(platform => {
        socialPlatforms[platform] = {
          platform: platform,
          status: 'pending',
          scheduledAt: scheduledDateTime,
          scheduled_at: scheduledDateTime
        };
      });

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/direct-schedule/${contentId}`,
        {
          scheduledAt: scheduledDateTime,
          socialPlatforms
        },
        { headers }
      );

      await ctx.reply(`✅ Публикация запланирована на ${schedulingDate} в ${schedulingTime} UTC для: ${platforms.join(', ')}!`);

      // Очищаем состояние планирования
      ctx.session.schedulingContentId = undefined;
      ctx.session.schedulingStep = undefined;
      ctx.session.schedulingDate = undefined;
      ctx.session.schedulingTime = undefined;
      ctx.session.schedulingPlatforms = undefined;

      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Назад к посту', `content_view_${contentId}`)]
      ]);

      await ctx.reply('Что делать дальше?', backButton);
    } catch (error: any) {
      console.error('Error scheduling content:', error);
      await ctx.reply(`❌ Ошибка при планировании: ${error.response?.data?.message || error.message}`);
    }
  }

  private async showCampaignsForContentCreation(ctx: BotContext) {
    try {
      if (!ctx.session.uploadedPhotoUrl) {
        return ctx.reply('❌ Ошибка: фото не найдено. Загрузите фото снова.');
      }

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      const response = await axios.get(`${API_BASE_URL}/api/campaigns`, {
        headers
      });

      const campaigns = response.data.data || response.data;

      if (!campaigns || campaigns.length === 0) {
        return ctx.reply('У вас пока нет кампаний. Создайте новую: /new_campaign');
      }

      const buttons = campaigns.slice(0, 10).map((campaign: any) => [
        Markup.button.callback(
          `📱 ${campaign.name || campaign.title}`,
          `photo_select_campaign_${campaign.id}`
        )
      ]);

      buttons.push([Markup.button.callback('❌ Отменить', 'photo_cancel')]);

      await ctx.reply(
        '📸 <b>Выберите кампанию для сохранения фото:</b>',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (error: any) {
      console.error('Error showing campaigns for photo:', error);
      await ctx.reply(`❌ Ошибка при получении кампаний: ${error.message}`);
    }
  }

  private async createContentWithPhoto(ctx: BotContext, campaignId: string) {
    try {
      if (!ctx.session.uploadedPhotoUrl) {
        return ctx.reply('❌ Ошибка: фото не найдено. Загрузите фото снова.');
      }

      const headers = await this.getAuthHeaders(ctx);
      if (!headers) {
        return ctx.reply('❌ Ошибка авторизации. Пожалуйста, выполните /login заново');
      }

      await ctx.reply('⏳ Сохраняю пост...');

      // Создаём новый контент с фото (и текстом, если есть)
      const response = await axios.post(
        `${API_BASE_URL}/api/campaign-content`,
        {
          campaign_id: campaignId,
          content: ctx.session.uploadedPhotoText || '', // Текст опционален
          image_url: ctx.session.uploadedPhotoUrl,
          status: 'draft',
          content_type: 'image'
        },
        { headers }
      );

      const savedContent = response.data.data || response.data;

      await ctx.reply(`✅ Пост с фото сохранён!`);

      // Очищаем данные из сессии
      ctx.session.uploadedPhotoUrl = undefined;
      ctx.session.uploadedPhotoCampaignId = undefined;
      ctx.session.uploadedPhotoText = undefined;

      const actionButtons = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Посмотреть пост', `content_view_${savedContent.id}`),
          Markup.button.callback('📤 Опубликовать', `content_publish_${savedContent.id}`)
        ],
        [
          Markup.button.callback('📅 Запланировать', `content_schedule_${savedContent.id}`)
        ],
        [
          Markup.button.callback('◀️ К кампании', `campaign_${campaignId}`),
          Markup.button.callback('📱 Главное меню', 'action_main_menu')
        ]
      ]);

      await ctx.reply('Что делать дальше?', actionButtons);
    } catch (error: any) {
      console.error('Error saving photo to campaign:', error);
      await ctx.reply(`❌ Ошибка при сохранении фото: ${error.message}`);
    }
  }

  private checkAuth(ctx: BotContext): boolean {
    if (!ctx.session.token) {
      ctx.reply('❌ Пожалуйста, сначала авторизуйтесь: /login');
      return false;
    }
    return true;
  }

  public async launch() {
    log.debug('🔧 [TelegramBotService] Вызов this.bot.launch()...');

    let startupError: Error | null = null;

    // bot.launch() в polling-режиме никогда не резолвится — запускаем в фоне
    this.bot.launch().catch((err: Error) => {
      startupError = err;
      console.error('❌ Telegram bot crashed:', err.message);
    });

    // Ждём 3 секунды — если не упал, значит успешно стартовал
    await new Promise(r => setTimeout(r, 3000));

    if (startupError) {
      throw startupError;
    }

    log.debug('✅ Telegram bot started successfully');
  }

  public async launchWebhook(domain: string) {
    try {
      log.debug('🔧 [TelegramBotService] Настройка webhook...');

      const webhookPath = '/telegram-webhook';
      const webhookUrl = `https://${domain}${webhookPath}`;

      // Устанавливаем webhook в Telegram
      await this.bot.telegram.setWebhook(webhookUrl);
      log.info('[telegram-bot] webhook set:', webhookUrl);

      // Возвращаем middleware для Express
      return this.bot.webhookCallback(webhookPath);
    } catch (error) {
      console.error('❌ Error setting up webhook:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('❌ Stack trace:', error.stack);
      }
      throw error;
    }
  }

  public getWebhookCallback(path: string) {
    return this.bot.webhookCallback(path);
  }

  public stop() {
    this.bot.stop();
  }

  /**
   * Отправляет сообщение пользователю по chatId
   */
  public async sendMessage(chatId: string | number, text: string, options: any = {}) {
    try {
      return await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        ...options
      });
    } catch (error) {
      console.error(`[TG-BOT] Ошибка отправки сообщения в чат ${chatId}:`, error);
      throw error;
    }
  }
}

export { TelegramBotService };
