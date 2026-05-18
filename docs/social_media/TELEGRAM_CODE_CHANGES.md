# Изменения кода для Telegram интеграции

## 1. Интерфейсы для TelegramS3Integration

```typescript
// server/services/social/telegram-s3-integration.ts

export interface TelegramVideoMessageOptions {
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  has_spoiler?: boolean;
  supports_streaming?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
}

// Для обратной совместимости добавляем интерфейс для параметризованного вызова
export interface TelegramVideoParams {
  videoUrl: string;
  chatId: string;
  token: string;
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  has_spoiler?: boolean;
  supports_streaming?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
}

export interface TelegramVideoResult {
  success: boolean;
  messageId?: number;
  error?: string;
  url?: string;
}
```

## 2. Перегрузка метода sendVideoToTelegram

```typescript
// server/services/social/telegram-s3-integration.ts

/**
 * Отправляет видео из Beget S3 в Telegram (перегрузка для объекта параметров)
 * @param params Объект с параметрами для отправки видео
 * @returns Результат отправки
 */
async sendVideoToTelegram(params: TelegramVideoParams): Promise<TelegramVideoResult>;

/**
 * Отправляет видео из Beget S3 в Telegram
 * @param videoUrl URL видео в Beget S3 или внешний URL
 * @param chatId ID чата в Telegram
 * @param token Токен бота Telegram
 * @param options Опции для отправки видео
 * @returns Результат отправки
 */
async sendVideoToTelegram(
  videoUrlOrParams: string | TelegramVideoParams,
  chatId?: string,
  token?: string,
  options: TelegramVideoMessageOptions = {}
): Promise<TelegramVideoResult> {
  // Проверяем, какая перегрузка вызвана
  if (typeof videoUrlOrParams === 'object') {
    // Вызов с объектом параметров
    const params = videoUrlOrParams;
    return this.sendVideoToTelegramImpl(
      params.videoUrl,
      params.chatId,
      params.token,
      {
        caption: params.caption,
        parse_mode: params.parse_mode,
        has_spoiler: params.has_spoiler,
        supports_streaming: params.supports_streaming,
        disable_notification: params.disable_notification,
        protect_content: params.protect_content,
        reply_to_message_id: params.reply_to_message_id,
        allow_sending_without_reply: params.allow_sending_without_reply
      }
    );
  } else {
    // Вызов с индивидуальными параметрами
    if (!chatId || !token) {
      return {
        success: false,
        error: 'Missing required parameters (chatId or token)'
      };
    }
    return this.sendVideoToTelegramImpl(videoUrlOrParams, chatId, token, options);
  }
}

/**
 * Внутренняя реализация отправки видео в Telegram
 * @private
 */
private async sendVideoToTelegramImpl(
  videoUrl: string,
  chatId: string,
  token: string,
  options: TelegramVideoMessageOptions = {}
): Promise<TelegramVideoResult> {
  // Реализация отправки
  // ...
}
```

## 3. Улучшенное форматирование URL в TelegramService

```typescript
// server/services/social/telegram-service.ts

/**
 * Генерирует URL для поста в Telegram
 * ВАЖНО: messageId является ОБЯЗАТЕЛЬНЫМ параметром в соответствии с TELEGRAM_POSTING_ALGORITHM.md
 * URL без messageId считается некорректным и не допускается согласно алгоритму!
 *
 * @param chatId ID чата Telegram
 * @param formattedChatId Форматированный ID чата для API
 * @param messageId ID сообщения (обязательный параметр)
 * @returns Полный URL для поста в Telegram
 * @throws Error если messageId не указан или пуст
 */
private generatePostUrl(chatId: string, formattedChatId: string, messageId: number | string): string {
  if (!messageId) {
    log(`Критическая ошибка: Не удалось получить messageId для формирования URL согласно TELEGRAM_POSTING_ALGORITHM.md`, 'social-publishing');
    throw new Error('MessageId is required for Telegram URL formation');
  }
  
  // Форматирование URL в зависимости от типа chatId
  // ...
}
```

## 4. Улучшенная обработка в TelegramService для видео

```typescript
// server/services/social/telegram-service.ts

async publishToTelegram(content: CampaignContent, telegramSettings: TelegramSettings): Promise<SocialPublicationResult> {
  // ...

  // Проверяем, содержит ли контент видео (в metadata.video_url или другом формате)
  const hasVideo = content.contentType === 'video' || 
    (content.metadata && 
      (content.metadata.video_url || content.metadata.videoUrl || 
      content.metadata.video || content.metadata.videoURL));
  
  if (hasVideo) {
    try {
      // Извлекаем URL видео из различных полей метаданных
      const videoUrl = content.metadata?.video_url || 
                       content.metadata?.videoUrl || 
                       content.metadata?.video || 
                       content.metadata?.videoURL;
      
      log(`Найдено видео для публикации в Telegram: ${videoUrl}`, 'social-publishing');
      
      // Подготавливаем текст в качестве подписи к видео
      const videoCaption = text.length <= 1024 ? text : text.substring(0, 1021) + '...';
      
      // Отправляем видео через специализированный сервис
      const videoResult = await this.telegramS3Integration.sendVideoToTelegram(
        videoUrl,
        formattedChatId,
        token,
        {
          caption: videoCaption,
          parse_mode: 'HTML'
        }
      );
      
      if (videoResult.success) {
        log(`Видео успешно отправлено в Telegram, ID сообщения: ${videoResult.messageId}`, 'social-publishing');
        
        // Убедимся, что messageId определен перед использованием
        if (!videoResult.messageId) {
          log(`Предупреждение: messageId не получен от сервиса отправки видео`, 'social-publishing');
          return {
            platform: 'telegram',
            status: 'published',
            publishedAt: new Date(),
            postUrl: 'https://t.me/' + (chatId.startsWith('@') ? chatId.substring(1) : chatId) // Временная ссылка
          };
        }
        
        return {
          platform: 'telegram',
          status: 'published',
          publishedAt: new Date(),
          postUrl: this.generatePostUrl(chatId, formattedChatId, videoResult.messageId || '0')
        };
      } else {
        log(`Ошибка при отправке видео в Telegram: ${videoResult.error}`, 'social-publishing');
        return {
          platform: 'telegram',
          status: 'failed',
          publishedAt: null,
          error: `Ошибка при отправке видео: ${videoResult.error}`
        };
      }
    } catch (error: any) {
      log(`Исключение при отправке видео в Telegram: ${error.message}`, 'social-publishing');
      return {
        platform: 'telegram',
        status: 'failed',
        publishedAt: null,
        error: `Исключение при отправке видео: ${error.message}`
      };
    }
  }
  
  // Остальная логика для изображений и текста
  // ...
}
```

## 5. Тестовые маршруты в test-routes.ts

```typescript
// server/api/test-routes.ts

/**
 * Тестовый маршрут для проверки отправки видео в Telegram
 * POST /api/test/telegram-video
 */
testRouter.post('/telegram-video', async (req: Request, res: Response) => {
  try {
    const { chatId, token, videoUrl, caption } = req.body;
    
    // Проверяем наличие обязательных параметров
    if (!videoUrl || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'Обязательные параметры: videoUrl и chatId'
      });
    }
    
    log(`[Test API] Запрос на отправку видео в Telegram`, 'test');
    log(`[Test API] URL видео: ${videoUrl}`, 'test');
    log(`[Test API] Chat ID: ${chatId}`, 'test');
    
    // Используем токен из запроса или из переменных окружения
    const botToken = token || process.env.TELEGRAM_BOT_TOKEN || '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
    
    // Получаем экземпляр сервиса TelegramS3Integration
    const { telegramS3Integration } = require('../services/social/telegram-s3-integration');
    
    // Отправляем видео в Telegram
    const result = await telegramS3Integration.sendVideoToTelegram(
      videoUrl,
      chatId,
      botToken,
      {
        caption: caption || 'Тестовое видео',
        parse_mode: 'HTML'
      }
    );
    
    log(`[Test API] Результат отправки видео: ${JSON.stringify(result)}`, 'test');
    
    // Возвращаем результат
    return res.json({
      success: result.success,
      messageId: result.messageId,
      url: result.url,
      error: result.error
    });
  } catch (error: any) {
    log(`[Test API] Ошибка при отправке видео в Telegram: ${error.message}`, 'test');
    return res.status(500).json({
      success: false,
      error: error.message || 'Неизвестная ошибка'
    });
  }
});

/**
 * Тестовый маршрут для проверки обработки видео в контенте для Telegram
 * POST /api/test/telegram-content-video
 */
testRouter.post('/telegram-content-video', async (req: Request, res: Response) => {
  try {
    const { chatId, token, videoUrl, text, campaignId } = req.body;
    
    // Проверяем наличие обязательных параметров
    if (!videoUrl || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'Обязательные параметры: videoUrl и chatId'
      });
    }
    
    log(`[Test API] Запрос на отправку контента с видео в Telegram`, 'test');
    
    // Используем токен из запроса или из переменных окружения
    const botToken = token || process.env.TELEGRAM_BOT_TOKEN || '7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU';
    
    // Создаем тестовый контент с видео
    const testContent = {
      id: `test-${Date.now()}`,
      title: 'Тест публикации видео',
      content: text || 'Тестовое видео для Telegram',
      contentType: 'video',
      imageUrl: '',
      additionalImages: [],
      status: 'draft',
      userId: 'test-user',
      campaignId: campaignId || 'test-campaign',
      socialPlatforms: ['telegram'],
      createdAt: new Date(),
      hashtags: [],
      links: [],
      metadata: {
        video_url: videoUrl  // Используем поле video_url в метаданных
      }
    };
    
    // Отправляем тестовый контент в Telegram
    const result = await telegramService.publishToTelegram(testContent, {
      token: botToken,
      chatId: chatId
    });
    
    log(`[Test API] Результат отправки контента с видео: ${JSON.stringify(result)}`, 'test');
    
    // Возвращаем результат
    return res.json({
      success: true,
      platform: result.platform,
      status: result.status,
      postUrl: result.postUrl,
      data: result
    });
  } catch (error: any) {
    log(`[Test API] Ошибка при отправке контента с видео в Telegram: ${error.message}`, 'test');
    console.error(error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Неизвестная ошибка'
    });
  }
});
```

## 6. Исправление порта в .env

```
PORT=5000  # Было PORT=5001
```