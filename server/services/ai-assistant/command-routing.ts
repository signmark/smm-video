import { CommandAnalysis, AvailableFunction } from './types';
import { geminiDirect } from '../gemini-direct';

export function initializeAvailableFunctions(): AvailableFunction[] {
  return [
    {
      name: 'create_posts',
      description: 'Создание постов для социальных сетей',
      parameters: {
        topic: { type: 'string', description: 'Тема постов', required: true },
        count: { type: 'number', description: 'Количество постов (1-10)', default: 1 },
        generateImages: { type: 'boolean', description: 'Генерировать изображения', default: true },
        isConnectedSeries: { type: 'boolean', description: 'Связная серия с единой нитью', default: false }
      },
      examples: ['Создай пост про веб-разработку', 'Напиши 3 поста про нейросети', 'Создай серию из 5 связанных постов']
    },
    {
      name: 'create_campaign',
      description: 'Создание новой рекламной кампании',
      parameters: {
        name: { type: 'string', description: 'Название кампании', required: true }
      },
      examples: ['Создай кампанию "Летняя акция"', 'Новая кампания с названием "Запуск продукта"']
    },
    {
      name: 'fill_questionnaire',
      description: 'Автоматическое заполнение бизнес-анкеты',
      parameters: {
        websiteUrl: { type: 'string', description: 'URL сайта для анализа', required: false }
      },
      examples: ['Заполни анкету', 'Создай анкету на основе сайта example.com']
    },
    {
      name: 'read_questionnaire',
      description: 'Чтение существующей бизнес-анкеты',
      parameters: {},
      examples: ['Прочитай анкету', 'Покажи данные анкеты', 'Что в анкете?']
    },
    {
      name: 'create_posts_from_questionnaire',
      description: 'Создание постов на основе данных анкеты',
      parameters: {
        count: { type: 'number', description: 'Количество постов (1-10)', default: 1 },
        postType: { type: 'string', description: 'Тип поста', enum: ['selling', 'informational', 'engaging'], default: 'selling' },
        characterLimit: { type: 'number', description: 'Лимит символов', required: false }
      },
      examples: ['Создай посты на основе анкеты', 'Напиши продающие посты из анкеты', 'Сделай 3 поста по анкете']
    },
    {
      name: 'get_campaign_data',
      description: 'Получение данных о кампании и её элементах',
      parameters: {
        dataType: { type: 'string', description: 'Тип данных', enum: ['content', 'analytics', 'settings', 'all'], default: 'all' }
      },
      examples: ['Покажи данные кампании', 'Что в кампании?', 'Покажи контент кампании']
    },
    {
      name: 'manage_content',
      description: 'Управление контентом кампании (просмотр, редактирование, удаление)',
      parameters: {
        action: { type: 'string', description: 'Действие', enum: ['list', 'delete', 'publish', 'schedule'], required: true },
        contentId: { type: 'string', description: 'ID контента', required: false }
      },
      examples: ['Покажи весь контент', 'Удали пост с ID 123', 'Опубликуй контент']
    },
    {
      name: 'schedule_posts',
      description: 'Планирование публикации контента в социальных сетях',
      parameters: {
        platforms: { type: 'array', description: 'Платформы: Instagram, Facebook, VK, Telegram, YouTube', default: ['Instagram'] },
        scheduleTime: { type: 'string', description: 'Время публикации', required: false }
      },
      examples: ['Запланируй эти посты в Instagram', 'Опубликуй в ТГ и ВК завтра']
    },
    {
      name: 'publish_content',
      description: 'Немедленная публикация контента в соцсетях',
      parameters: {
        platforms: { type: 'array', description: 'Платформы для публикации', default: ['Instagram'] },
        contentId: { type: 'string', description: 'ID контента для публикации', required: false }
      },
      examples: ['Опубликуй сейчас в Instagram', 'Размести этот пост в VK']
    },
    {
      name: 'generate_image',
      description: 'Генерация изображений для контента',
      parameters: {
        prompt: { type: 'string', description: 'Описание изображения', required: true },
        count: { type: 'number', description: 'Количество изображений (1-5)', default: 1 }
      },
      examples: ['Создай картинку с котом', 'Генерируй 3 изображения про бизнес']
    },
    {
      name: 'analyze_campaign',
      description: 'Анализ эффективности кампании',
      parameters: {
        analysisType: { type: 'string', description: 'Тип анализа', default: 'general' },
        timeframe: { type: 'string', description: 'Временной период', default: 'week' }
      },
      examples: ['Проанализируй кампанию', 'Покажи статистику за месяц']
    },
    {
      name: 'create_stories',
      description: 'Создание Stories для Instagram',
      parameters: {
        topic: { type: 'string', description: 'Тема Stories', required: true },
        count: { type: 'number', description: 'Количество Stories (1-10)', default: 1 }
      },
      examples: ['Создай Stories про новый продукт', 'Сделай 5 Stories про путешествия']
    },
    {
      name: 'get_analytics',
      description: 'Получение аналитики по соцсетям',
      parameters: {
        platform: { type: 'string', description: 'Платформа для анализа', required: false },
        period: { type: 'string', description: 'Период анализа', default: 'week' }
      },
      examples: ['Покажи аналитику Instagram', 'Статистика за последний месяц']
    },
    {
      name: 'generate_hashtags',
      description: 'Генерация хештегов для контента',
      parameters: {
        topic: { type: 'string', description: 'Тема для хештегов', required: true },
        hashtagCount: { type: 'number', description: 'Количество хештегов (5-30)', default: 10 }
      },
      examples: ['Создай хештеги для фитнеса', 'Генерируй 20 хештегов про кулинарию']
    },
    {
      name: 'collect_trends',
      description: 'Запуск сбора актуальных трендов для кампании',
      parameters: {},
      examples: ['Собери тренды', 'Запусти сбор трендов', 'Найди новые тренды']
    },
    {
      name: 'start_scheduler',
      description: 'Запуск автоматического планировщика публикаций',
      parameters: {},
      examples: ['Запусти планировщик', 'Включи автопубликацию']
    },
    {
      name: 'stop_scheduler',
      description: 'Остановка автоматического планировщика',
      parameters: {},
      examples: ['Останови планировщик', 'Выключи автопубликацию']
    },
    {
      name: 'help',
      description: 'Показать справку и доступные команды',
      parameters: {},
      examples: ['Помощь', 'Что ты умеешь?', 'Справка']
    },
    {
      name: 'unknown',
      description: 'Неизвестная команда - требует уточнения',
      parameters: {},
      examples: []
    }
  ];
}

export async function aiRoutingAnalyzeCommand(message: string, availableFunctions: AvailableFunction[]): Promise<CommandAnalysis> {
  try {
    const functionsSchema = availableFunctions.map(func => ({
      name: func.name,
      description: func.description,
      parameters: func.parameters,
      examples: func.examples
    }));

    const aiPrompt = `
Ты интеллектуальный роутер команд для SMM-платформы. Проанализируй команду пользователя и определи какую функцию нужно вызвать.

ДОСТУПНЫЕ ФУНКЦИИ:
${JSON.stringify(functionsSchema, null, 2)}

КОМАНДА ПОЛЬЗОВАТЕЛЯ: "${message}"

Проанализируй команду и верни ТОЛЬКО JSON в формате:
{
  "intent": "название_функции",
  "confidence": число_от_0_до_1,
  "parameters": {
    "param1": "значение1",
    "param2": значение2
  },
  "reasoning": "краткое объяснение выбора"
}

ПРАВИЛА АНАЛИЗА:
1. Если упоминается количество (2 поста, 5 штук) - извлеки число в count
2. Если есть "серия", "связанн", "история", "нить" - isConnectedSeries: true
3. Если "без картинок", "только текст" - generateImages: false, иначе true
4. Если "про что-то" - извлеки тему в topic
5. Платформы: Instagram, Facebook, VK, Telegram, YouTube
6. Если не понял команду - intent: "unknown"

ОТВЕТ (ТОЛЬКО JSON):`;

    const response = await geminiDirect.generateContent({
      prompt: aiPrompt,
      model: 'gemini-3-pro-preview'
    });

    let parsedResponse;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON не найден в ответе');
      }
    } catch (parseError) {
      console.error('[AI-ROUTING] Ошибка парсинга JSON:', parseError);
      return fallbackAnalyzeCommand(message);
    }

    const intent = parsedResponse.intent || 'unknown';
    const confidence = Math.min(Math.max(parsedResponse.confidence || 0.5, 0), 1);
    let parameters = parsedResponse.parameters || {};

    const MIN_CONFIDENCE = 0.6;
    if (confidence < MIN_CONFIDENCE) {
      console.log(`[AI-ROUTING] Низкая уверенность (${confidence}), fallback к старому методу`);
      return fallbackAnalyzeCommand(message);
    }

    parameters = validateAndNormalizeParameters(intent, parameters, availableFunctions);

    console.log(`[AI-ROUTING] Команда: "${message}" -> Intent: ${intent}, Confidence: ${confidence}, Params:`, parameters);

    return {
      intent: intent as any,
      confidence,
      parameters
    };

  } catch (error) {
    console.error('[AI-ROUTING] Ошибка AI-роутинга:', error);
    return fallbackAnalyzeCommand(message);
  }
}

export function validateAndNormalizeParameters(intent: string, params: any, availableFunctions: AvailableFunction[]): any {
  const validatedParams: any = {};
  
  const functionSchema = availableFunctions.find(f => f.name === intent);
  if (!functionSchema) {
    return {};
  }

  for (const [paramName, paramSchema] of Object.entries(functionSchema.parameters)) {
    const value = params[paramName];
    
    if (value === undefined || value === null) {
      if (paramSchema.default !== undefined) {
        validatedParams[paramName] = paramSchema.default;
      }
      continue;
    }

    switch (paramSchema.type) {
      case 'string':
        if (typeof value === 'string') {
          validatedParams[paramName] = value.substring(0, 500);
        }
        break;
        
      case 'number':
        const numValue = typeof value === 'number' ? value : parseInt(value);
        if (!isNaN(numValue)) {
          if (paramName === 'count') {
            validatedParams[paramName] = Math.min(Math.max(numValue, 1), 10);
          } else if (paramName === 'hashtagCount') {
            validatedParams[paramName] = Math.min(Math.max(numValue, 5), 30);
          } else {
            validatedParams[paramName] = Math.min(Math.max(numValue, 1), 100);
          }
        }
        break;
        
      case 'boolean':
        validatedParams[paramName] = Boolean(value);
        break;
        
      case 'array':
        if (Array.isArray(value)) {
          if (paramName === 'platforms') {
            const allowedPlatforms = ['Instagram', 'Facebook', 'VK', 'Telegram', 'YouTube'];
            validatedParams[paramName] = value.filter(p => 
              allowedPlatforms.includes(p)
            ).slice(0, 5);
          } else {
            validatedParams[paramName] = value.slice(0, 10);
          }
        }
        break;
    }
  }

  return validatedParams;
}

export async function analyzeCommand(message: string): Promise<CommandAnalysis> {
  try {
    const prompt = `
Ты - эксперт по анализу команд для системы управления социальными сетями.

Проанализируй следующую команду пользователя и определи:
1. Намерение (intent)
2. Уровень уверенности (0-1)
3. Параметры команды

Возможные намерения:
- fill_questionnaire: заполнить анкету, анкета, бизнес-анкета, автозаполнение
- read_questionnaire: прочитать анкету, покажи анкету, что в анкете, данные анкеты
- create_posts_from_questionnaire: посты на основе анкеты, по анкете, из анкеты, продающие посты из анкеты
- get_campaign_data: данные кампании, что в кампании, покажи кампанию, информация о кампании
- manage_content: управление контентом, покажи контент, список постов, удали контент
- create_posts: создать посты, сгенерировать контент, написать посты, продающий пост
- create_campaign: создать кампанию, новая кампания, создай кампанию с названием
- schedule_posts: запланировать публикации, запостить, опубликовать, расписание
- publish_content: опубликовать контент, публикация конкретного контента по ID
- generate_image: создать изображение, сгенерировать картинку, фото, визуал
- analyze_campaign: анализ кампании, эффективность, статистика, результаты
- create_stories: создать Stories, истории, сториз для Instagram
- get_analytics: аналитика, метрики, показатели, охваты, вовлечения
- setup_social_accounts: настроить аккаунты, подключить соцсети, OAuth, авторизация
- optimize_content: оптимизировать контент, улучшить посты, A/B тест
- analyze_trends: тренды, актуальное, популярное, что в моде, анализ трендов
- start_scheduler: запустить планировщик, включить автопубликацию
- stop_scheduler: остановить планировщик, выключить автопубликацию
- analyze_competitors: анализ конкурентов, что делают конкуренты
- generate_hashtags: хештеги, теги, #, подобрать хештеги
- schedule_optimal_time: лучшее время публикации, когда постить, оптимальное время
- help: помощь, что ты умеешь, команды, возможности

Команда: "${message}"

Ответь ТОЛЬКО в формате JSON:
{
  "intent": "намерение",
  "confidence": число_от_0_до_1,
  "parameters": {
    "topic": "тема_если_есть",
    "count": число_постов_если_указано,
    "platforms": ["платформы_если_указаны"],
    "generateImages": true/false,
    "scheduleTime": "время_если_указано",
    "url": "URL_сайта_если_указан"
  }
}
`;

    const response = await geminiDirect.generateContent({ 
      prompt,
      model: 'gemini-3-pro-preview'
    });

    const cleanedResponse = response.replace(/```json|```/g, '').trim();
    const analysis: CommandAnalysis = JSON.parse(cleanedResponse);
    
    return analysis;
  } catch (error) {
    console.error('[AI-ASSISTANT] Ошибка анализа команды:', error);
    return fallbackAnalyzeCommand(message);
  }
}

export function fallbackAnalyzeCommand(message: string): CommandAnalysis {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('кампани') || lowerMessage.includes('campaign')) {
    const nameMatch = lowerMessage.match(/(?:с названием|названием|name)\s*["']?([^"']+)["']?/i) ||
                     lowerMessage.match(/кампанию\s*["']?([^"']+)["']?/i);
    const campaignName = nameMatch ? nameMatch[1].trim() : 'Новая кампания';

    // Извлекаем URL если есть
    const urlMatch = lowerMessage.match(/(https?:\/\/[^\s]+)/i);
    const url = urlMatch ? urlMatch[1] : undefined;

    return {
      intent: 'create_campaign',
      confidence: 0.8,
      parameters: {
        name: campaignName,
        url
      }
    };
  }
  
  if (lowerMessage.includes('создай') || lowerMessage.includes('create') || 
      lowerMessage.includes('пост') || lowerMessage.includes('post') ||
      lowerMessage.includes('напиши') || lowerMessage.includes('write')) {
    
    let count = 1;
    
    const postCountMatch = lowerMessage.match(/(?:создай|напиши|сделай|генерируй).*?(\d{1,2})\s*(?:пост(?:а|ов)?|штук?|шт|post(?:s)?)/i);
    
    if (postCountMatch) {
      const extractedCount = parseInt(postCountMatch[1]);
      count = Math.min(extractedCount, 10);
    } else if (lowerMessage.includes('серия') || lowerMessage.includes('несколько') || lowerMessage.includes('много')) {
      count = 3;
    } else if (lowerMessage.includes('продающий') || lowerMessage.includes('на основе анкеты')) {
      count = 1;
    }
    
    const isEnglish = lowerMessage.includes('english') || lowerMessage.includes('in english');
    const language = isEnglish ? 'en' : 'ru';
    
    let topic = '';
    
    const cleanMessage = lowerMessage
      .replace(/создай|напиши|сделай|генерируй|create|write|make/g, '')
      .replace(/\d+\s*(пост|post|штук|шт)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const proMatch = cleanMessage.match(/про\s+(.+)/);
    if (proMatch) {
      topic = proMatch[1].trim();
    } else {
      topic = cleanMessage || 'актуальные темы для бизнеса';
    }
    
    const skipImages = lowerMessage.includes('без картинк') || lowerMessage.includes('без изображени') || 
                      lowerMessage.includes('только текст') || lowerMessage.includes('no image') ||
                      lowerMessage.includes('text only');
    const generateImages = !skipImages;
    
    const isConnectedSeries = count > 1 && (
      lowerMessage.includes('серия') || lowerMessage.includes('связанн') || 
      lowerMessage.includes('продолжени') || lowerMessage.includes('нить') || 
      lowerMessage.includes('история') || lowerMessage.includes('повествовани') ||
      lowerMessage.includes('connected') || lowerMessage.includes('story') ||
      lowerMessage.includes('series')
    );
    
    return {
      intent: 'create_posts',
      confidence: 0.8,
      parameters: {
        topic,
        count,
        // language,
        generateImages,
        isConnectedSeries
      }
    };
  }
  
  if (lowerMessage.includes('заполни') || lowerMessage.includes('анкет') || lowerMessage.includes('форм')) {
    return {
      intent: 'fill_questionnaire',
      confidence: 0.8
    };
  }

  if ((lowerMessage.includes('прочитай') || lowerMessage.includes('покажи') || lowerMessage.includes('что в')) && 
      lowerMessage.includes('анкет')) {
    return {
      intent: 'read_questionnaire',
      confidence: 0.8
    };
  }

  if ((lowerMessage.includes('пост') || lowerMessage.includes('контент')) && 
      (lowerMessage.includes('из анкеты') || lowerMessage.includes('на основе анкеты') || lowerMessage.includes('по анкете'))) {
    return {
      intent: 'create_posts_from_questionnaire',
      confidence: 0.9
    };
  }

  if ((lowerMessage.includes('данные') || lowerMessage.includes('что в') || lowerMessage.includes('покажи')) && 
      lowerMessage.includes('кампани')) {
    return {
      intent: 'get_campaign_data',
      confidence: 0.8
    };
  }

  if (lowerMessage.includes('покажи контент') || lowerMessage.includes('список постов') || 
      lowerMessage.includes('удали контент') || lowerMessage.includes('управление контентом')) {
    return {
      intent: 'manage_content',
      confidence: 0.8
    };
  }
  
  if (lowerMessage.includes('запланируй') || lowerMessage.includes('schedule') || lowerMessage.includes('опубликуй')) {
    return {
      intent: 'schedule_posts', 
      confidence: 0.8
    };
  }
  
  if (lowerMessage.includes('помощь') || lowerMessage.includes('help') || lowerMessage.includes('справка')) {
    return {
      intent: 'help',
      confidence: 0.9
    };
  }
  
  if (lowerMessage.includes('собери') && lowerMessage.includes('тренды') || 
      lowerMessage.includes('collect') && lowerMessage.includes('trends') ||
      lowerMessage.includes('запусти') && lowerMessage.includes('сбор') ||
      lowerMessage.includes('start') && lowerMessage.includes('collection')) {
    return {
      intent: 'collect_trends',
      confidence: 0.9
    };
  }
  
  return {
    intent: 'unknown',
    confidence: 0.1
  };
}
