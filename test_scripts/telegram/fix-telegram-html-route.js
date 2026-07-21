/**
 * Исправление маршрута для тестирования HTML-форматирования в Telegram
 * Данный скрипт должен быть интегрирован в код server/api/test-routes.ts
 * 
 * Предложения по исправлению существующего маршрута telegram-emoji-html
 */

/**
 * Исправленный маршрут для прямой отправки HTML и эмодзи в Telegram
 * POST /api/test/telegram-emoji-html
 * 
 * 1. Явно используем DEFAULT_CAMPAIGN_ID для случаев, когда кампания не найдена
 * 2. Обрабатываем ошибку отсутствия настроек Telegram
 * 3. Используем константные токен и chatId, если настройки не получены из кампании
 * 4. Возвращаем более детальную информацию о результате отправки
 * 
 * Пример использования:
 * POST /api/test/telegram-emoji-html
 * Body: {
 *   "text": "<b>Жирный текст</b>, <i>курсив</i> и эмодзи 🎉",
 *   "campaignId": "46868c44-c6a4-4bed-accf-9ad07bba790e"
 * }
 */

/*
testRouter.post('/telegram-emoji-html', async (req: Request, res: Response) => {
  try {
    const { text, campaignId } = req.body;
    
    // ID кампании по умолчанию на случай, если не удается получить указанную кампанию
    const DEFAULT_CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
    
    // Резервные тестовые настройки Telegram (используются, если не удается получить из кампании)
    const FALLBACK_TELEGRAM_TOKEN = 'REVOKED_TELEGRAM_TOKEN_USE_ENV';
    const FALLBACK_TELEGRAM_CHAT_ID = '-1002302366310';
    
    // Проверяем наличие обязательных параметров
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Обязательный параметр: text'
      });
    }
    
    log(`[Test API] Запрос на отправку HTML и эмодзи в Telegram`, 'test');
    log(`[Test API] Текст: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`, 'test');
    
    // Получаем настройки кампании с дополнительной отладкой
    let campaignToUse = campaignId || DEFAULT_CAMPAIGN_ID;
    
    // Получаем админский токен для авторизации (но не обязательно)
    const adminToken = await storage.getAdminToken();
    console.log(`[Test API] Админский токен получен: ${adminToken ? 'да' : 'нет'}`);
    
    // Получаем настройки кампании
    console.log(`[Test API] Запрашиваем кампанию ${campaignToUse}`);
    let campaign = await storage.getCampaignById(campaignToUse);
    
    // Настройки Telegram, которые будут использоваться
    let token = FALLBACK_TELEGRAM_TOKEN;
    let chatId = FALLBACK_TELEGRAM_CHAT_ID;
    
    // Если кампания найдена и имеет настройки Telegram, используем их
    if (campaign && campaign.settings && campaign.settings.telegram) {
      console.log(`[Test API] Получены настройки Telegram из кампании`);
      
      // Используем настройки из кампании, если они доступны
      if (campaign.settings.telegram.token) {
        token = campaign.settings.telegram.token;
      }
      
      if (campaign.settings.telegram.chatId) {
        chatId = campaign.settings.telegram.chatId;
      }
    } else {
      console.log(`[Test API] Используем резервные настройки Telegram для тестирования`);
    }
    
    // Проверяем наличие токена и chatId
    if (!token || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют настройки для Telegram (токен или ID чата)'
      });
    }
    
    // Формируем тестовый контент
    const testContent = {
      id: `test-${Date.now()}`,
      title: 'Тест HTML-форматирования',
      content: text,
      contentType: 'text',
      imageUrl: '',
      additionalImages: [],
      status: 'draft',
      userId: 'test-user',
      campaignId: campaignToUse,
      socialPlatforms: ['telegram'],
      createdAt: new Date(),
      hashtags: [],
      links: [],
      metadata: {}
    };
    
    // Сохраняем оригинальный текст для отладки
    const originalText = text;
    
    // Форматируем текст через TelegramService
    const formattedText = telegramService.formatTextForTelegram(text);
    
    // Отправляем тестовое сообщение в Telegram
    const result = await telegramService.publishToTelegram(testContent, {
      token,
      chatId
    });
    
    // Логируем результат для отладки
    console.log(`[Test API] Результат отправки HTML-сообщения в Telegram:`, result);
    
    // Возвращаем расширенный результат
    return res.json({
      success: true,
      message_id: result.messageId,
      message_url: result.postUrl,
      platform: result.platform,
      status: result.status,
      original_text: originalText,
      formatted_text: formattedText,
      used_campaign_id: campaignToUse,
      used_fallback_settings: !campaign || !campaign.settings || !campaign.settings.telegram
    });
  } catch (error: any) {
    console.error('[Test API] Ошибка при отправке HTML и эмодзи в Telegram:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Неизвестная ошибка',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
*/