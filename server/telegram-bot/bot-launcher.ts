import { TelegramBotService } from './index';

let botInstance: TelegramBotService | null = null;
let webhookCallbackInstance: any = null;

export function getWebhookCallback() {
  return webhookCallbackInstance;
}

export async function startTelegramBot() {
  // Читаем токен в момент запуска (не при импорте модуля),
  // чтобы loadEnvFromDirectus() успела заполнить process.env
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN не найден. Telegram бот не будет запущен.');
    console.warn('    Добавьте TELEGRAM_BOT_TOKEN в Directus global_api_keys или .env');
    return null;
  }

  if (botInstance) {
    console.log('ℹ️  Telegram бот уже запущен');
    return botInstance;
  }

  try {
    // КРИТИЧНО: Проверяем доступность Directus перед запуском бота
    console.log('[TelegramBot] Проверка доступности Directus...');
    const { checkDirectusHealth } = await import('../optimize-startup');
    const isDirectusHealthy = await checkDirectusHealth(3); // 3 попытки
    
    if (!isDirectusHealthy) {
      console.error('❌ [TelegramBot] Directus недоступен. Telegram бот запустится в ограниченном режиме.');
      console.warn('    Бот будет работать без постоянного хранения сессий.');
      // Продолжаем запуск бота даже если Directus недоступен
    }
    
    // Проверяем доступность коллекции telegram_sessions
    const { telegramSessionStorage } = await import('../services/telegram-session-storage');
    const collectionAvailable = await telegramSessionStorage.checkCollection();
    
    if (!collectionAvailable) {
      console.warn('⚠️  Коллекция telegram_sessions недоступна.');
      console.warn('    Создайте коллекцию вручную в Directus для постоянного хранения сессий.');
      console.warn('    Бот продолжит работу с временными сессиями в памяти.');
    }
    
    console.log('📦 Создание экземпляра TelegramBotService...');
    botInstance = new TelegramBotService(TELEGRAM_BOT_TOKEN);
    
    // Определяем webhook URL из переменной окружения Replit
    const webhookDomain = process.env.REPLIT_DEV_DOMAIN;
    
    if (webhookDomain) {
      console.log('🌐 Запуск бота в webhook режиме...');
      console.log(`📍 Webhook URL: https://${webhookDomain}/telegram-webhook`);
      webhookCallbackInstance = await botInstance.launchWebhook(webhookDomain);
      console.log('✅ Webhook callback готов к использованию');
    } else {
      console.log('🚀 Запуск бота в polling режиме...');
      await botInstance.launch();
    }
    
    console.log('🤖 Telegram бот успешно запущен и готов к работе!');
    
    process.once('SIGINT', () => {
      console.log('🛑 Остановка Telegram бота...');
      try { botInstance?.stop(); } catch (e) { /* already stopped */ }
    });
    process.once('SIGTERM', () => {
      console.log('🛑 Остановка Telegram бота...');
      try { botInstance?.stop(); } catch (e) { /* already stopped */ }
    });

    return botInstance;
  } catch (error) {
    console.error('❌ Ошибка при запуске Telegram бота:', error);
    console.error('❌ Стек ошибки:', error instanceof Error ? error.stack : 'Стек недоступен');
    return null;
  }
}

export function stopTelegramBot() {
  if (botInstance) {
    try {
      botInstance.stop();
    } catch (e) {
      // Bot may already be stopped — ignore
    }
    botInstance = null;
    console.log('✅ Telegram бот остановлен');
  }
}

export function getTelegramBot() {
  return botInstance;
}
