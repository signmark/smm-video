import axios from 'axios';
import * as logger from '../utils/logger';
import { apiKeyService } from './api-keys';
import { GlobalApiKeysService } from './global-api-keys';
import { ApiServiceName } from './api-keys';

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  messages: {
    role: string;
    content: string;
  }[];
}

export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: {
    type: string;
    text: string;
  }[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeImproveTextParams {
  text: string;
  prompt: string;
  model?: string;
}

interface SocialContentParams {
  platform?: string;
  tone?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

/**
 * Сервис для работы с Claude API
 */
export class ClaudeService {
  private apiKey: string | null = null;
  private apiUrl = 'https://api.anthropic.com/v1/messages';
  private defaultModel = 'claude-3-haiku-20240307'; // Fallback to more accessible model
  private isInitialized = false;
  private globalApiKeysService: GlobalApiKeysService;

  constructor(apiKey?: string) {
    this.globalApiKeysService = new GlobalApiKeysService();
    if (apiKey) {
      this.apiKey = apiKey;
      this.isInitialized = true;
    }
  }
  
  /**
   * Инициализирует сервис Claude с ключом из Directus Global API Keys
   * @param userId ID пользователя (опционально, для совместимости)
   * @param token Токен авторизации (опционально)
   * @returns true, если инициализация успешна, иначе false
   */
  async initialize(userId?: string, token?: string): Promise<boolean> {
    try {
      if (this.isInitialized && this.apiKey) {
        logger.log(`Claude service already initialized`, 'claude');
        return true;
      }
      
      logger.log(`Initializing Claude service from Global API Keys`, 'claude');
      
      // Получаем API ключ только из Directus Global API Keys
      this.apiKey = await this.globalApiKeysService.getGlobalApiKey(ApiServiceName.CLAUDE);
      
      if (!this.apiKey) {
        logger.error(`Claude API key not found in Global API Keys collection`, 'claude');
        return false;
      }
      
      logger.log(`Claude service initialized with global API key from Directus`, 'claude');
      
      // Проверяем валидность ключа
      const isValid = await this.testApiKey();
      if (!isValid) {
        logger.error(`Claude API key from Global API Keys is invalid`, 'claude');
        this.apiKey = null;
        return false;
      }
      
      this.isInitialized = true;
      logger.log(`Claude service successfully initialized for user ${userId}`, 'claude');
      return true;
    } catch (error) {
      logger.error('Error initializing Claude service:', error, 'claude');
      this.apiKey = null;
      this.isInitialized = false;
      return false;
    }
  }
  
  /**
   * Проверяет, инициализирован ли сервис с API ключом
   */
  hasApiKey(): boolean {
    return this.isInitialized && !!this.apiKey;
  }

  /**
   * Проверяет доступность API ключа
   */
  async testApiKey(): Promise<boolean> {
    try {
      if (!this.apiKey) {
        logger.error('Cannot test API key: No API key provided', 'claude');
        return false;
      }
      
      // Маскируем ключ для логирования
      const maskedKey = this.apiKey.substring(0, 4) + '...' + this.apiKey.substring(this.apiKey.length - 4);
      logger.log(`Testing Claude API key starting with: ${maskedKey}`, 'claude');
      
      // Небольшой prompt для проверки ключа
      const testModel = 'claude-3-haiku-20240307'; // Используем самую маленькую модель для быстрой проверки
      logger.log(`Using model ${testModel} for API key test`, 'claude');
      
      // Дополнительное логирование для отладки процесса проверки ключа
      logger.log(`API URL: ${this.apiUrl}`, 'claude');
      logger.log(`API Key format verification: ${this.apiKey?.startsWith('sk-ant-')}`, 'claude');
      
      const result = await this.makeRequest({
        model: testModel,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Say "API key is valid" if you can read this message.'
          }
        ]
      });
      
      // Проверяем, получили ли мы осмысленный ответ
      const hasValidResponse = result && 
        result.content && 
        result.content.length > 0 && 
        result.content[0].text.includes('valid');
      
      logger.log(`Claude API key test result: ${hasValidResponse ? 'Valid' : 'Invalid'}, response content: ${JSON.stringify(result?.content)}`, 'claude');
      return hasValidResponse;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error;
        logger.error(`Claude API key test failed with status: ${axiosError.response?.status}`, 'claude');
        logger.error(`Error details: ${JSON.stringify(axiosError.response?.data)}`, 'claude');
        
        if (axiosError.response?.status === 401) {
          logger.error('Claude API key is invalid or expired (401 Unauthorized)', 'claude');
          logger.error('Проверьте ваш ключ Claude API. Возможно, ключ устарел или был отозван. Получите новый ключ в личном кабинете Anthropic и обновите его в настройках приложения.', 'claude');
        } else if (axiosError.response?.status === 400) {
          logger.error('Claude API request is malformed (400 Bad Request)', 'claude');
        } else if (axiosError.response?.status === 429) {
          logger.error('Claude API rate limit exceeded (429 Too Many Requests)', 'claude');
        }
      } else {
        logger.error('Error testing Claude API key:', error, 'claude');
      }
      return false;
    }
  }

  /**
   * Улучшает текст с помощью Claude AI
   */
  async improveText({ text, prompt, model }: ClaudeImproveTextParams): Promise<string> {
    logger.log('Improving text with Claude AI...', 'claude');
    
    if (!this.apiKey) {
      throw new Error('Claude API key is not configured');
    }
    
    // Приоритет моделей для fallback (от самой доступной к более требовательной)
    const modelPriority = [
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229',
      'claude-3-5-sonnet-20241022'
    ];
    
    const requestModel = model || this.defaultModel;
    
    // Если указана конкретная модель, попробуем её, но добавим fallback
    const modelsToTry = requestModel === this.defaultModel 
      ? modelPriority 
      : [requestModel, ...modelPriority.filter(m => m !== requestModel)];
    
    let lastError: any = null;
    
    // Попробуем разные модели до тех пор, пока одна не сработает
    for (const tryModel of modelsToTry) {
      try {
        logger.log(`Trying Claude model: ${tryModel}`, 'claude');
        
        // Определяем, содержит ли текст HTML-теги
        const containsHtml = /<[^>]+>/.test(text);
      
      // Если текст содержит HTML, добавляем специальные инструкции для сохранения форматирования
      let contentPrompt = '';
      if (containsHtml) {
        contentPrompt = `${prompt}

КРИТИЧЕСКИ ВАЖНО: 
1. ОБЯЗАТЕЛЬНО верни ПОЛНЫЙ улучшенный текст БЕЗ СОКРАЩЕНИЙ
2. Сохрани ВСЕ HTML-теги и структуру форматирования
3. НЕ ОБРЕЗАЙ текст на середине предложения
4. НЕ добавляй комментарии, объяснения или служебный текст
5. Начни ответ сразу с улучшенного текста
6. Завершай текст только после полной обработки всего исходного контента

Исходный текст для улучшения:
${text}

Улучшенная версия:`;
      } else {
        // Обычный промпт с поддержкой markdown форматирования
        contentPrompt = `${prompt}

ВАЖНО: 
1. Верни ВЕСЬ улучшенный текст ПОЛНОСТЬЮ
2. НЕ сокращай и НЕ обрезай текст - верни его целиком
3. Не добавляй объяснения, комментарии или дополнительный текст

Исходный текст: ${text}

Улучшенный текст:`;
      }
      
        // Используем правильные лимиты для разных моделей Claude
        let maxTokens = 4000; // По умолчанию безопасный лимит
        
        // Устанавливаем лимиты в зависимости от модели
        if (tryModel.includes('claude-3-5-sonnet-20241022')) {
          maxTokens = 7000; // Для новой модели можем использовать больше
        } else if (tryModel.includes('claude-3-5-sonnet')) {
          maxTokens = 6000; // Для обычных моделей Sonnet
        } else if (tryModel.includes('claude-3-haiku')) {
          maxTokens = 4000; // Для Haiku меньший лимит
        }
        
        const result = await this.makeRequest({
          model: tryModel,
          max_tokens: maxTokens,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: contentPrompt
            }
          ]
        });
      
      if (!result || !result.content || result.content.length === 0) {
        throw new Error('Claude API returned empty response');
      }
      
      let improvedText = result.content[0].text.trim();
      
      // Детальное логирование для диагностики
      console.log('[CLAUDE DEBUG] Full API response length:', improvedText.length);
      console.log('[CLAUDE DEBUG] Full API response:', improvedText.substring(0, 500) + (improvedText.length > 500 ? '...' : ''));
      console.log('[CLAUDE DEBUG] Usage stats:', result.usage);
      
      // Удаляем служебный текст в тройных обратных кавычках (```)
      improvedText = improvedText.replace(/```[\s\S]*?```/g, '');
      
      // Удаляем лишние разделители --- в начале и конце текста
      improvedText = improvedText.replace(/^---\s*\n?/g, ''); // Удаляем --- в начале
      improvedText = improvedText.replace(/\n?\s*---\s*$/g, ''); // Удаляем --- в конце
      
      // Простая очистка от служебного текста - оставляем весь контент
      // Удаляем только явные инструкции в начале ответа
      const lines = improvedText.split('\n');
      let startIndex = 0;
      
      // Пропускаем строки с инструкциями в начале
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (lower.includes('let me') || lower.includes('here is') || lower.includes('here\'s') || lines[i].trim() === '') {
          startIndex = i + 1;
        } else {
          break;
        }
      }
      
      // Берем весь контент начиная с первой содержательной строки
      if (startIndex < lines.length) {
        improvedText = lines.slice(startIndex).join('\n');
      }
      
      improvedText = improvedText.trim(); // Убираем лишние пробелы
      
      // Если оригинальный текст содержал HTML, но ответ не содержит, 
      // попробуем заключить абзацы в теги <p>
      if (containsHtml && !/<[^>]+>/.test(improvedText)) {
        logger.log('HTML tags were not preserved, attempting to add paragraph tags', 'claude');
        improvedText = improvedText
          .split('\n\n')
          .map(para => para.trim())
          .filter(para => para.length > 0)
          .map(para => `<p>${para}</p>`)
          .join('\n');
      }
      
        logger.log(`Text successfully improved with Claude AI using model: ${tryModel}`, 'claude');
        return improvedText;
        
      } catch (error: any) {
        lastError = error;
        logger.log(`Model ${tryModel} failed: ${error.response?.status} - ${error.message}`, 'claude');
        
        // Если это 403, попробуем следующую модель
        if (error.response?.status === 403) {
          continue;
        }
        
        // Для других ошибок тоже попробуем следующую модель
        continue;
      }
    }
    
    // Если все модели не сработали, выбрасываем ошибку
    console.log('Claude API Full Error:', lastError);
    console.log('Claude API Response status:', lastError?.response?.status);
    console.log('Claude API Response data:', lastError?.response?.data);
    logger.error('Error improving text with Claude (all models failed):', lastError, 'claude');
    
    const errorMessage = lastError?.response?.data?.error?.message || lastError?.message || String(lastError);
    throw new Error(`Failed to improve text with Claude (tried ${modelsToTry.length} models): ` + errorMessage);
  }

  /**
   * Генерирует контент на основе промпта
   */
  async generateContent(prompt: string, model?: string): Promise<string> {
    logger.log('Generating content with Claude AI...', 'claude');
    
    if (!this.apiKey) {
      throw new Error('Claude API key is not configured');
    }
    
    const requestModel = model || this.defaultModel;
    
    try {
      const result = await this.makeRequest({
        model: requestModel,
        max_tokens: requestModel.includes('claude-3-5-sonnet-20241022') ? 7000 : 
                   requestModel.includes('claude-3-5-sonnet') ? 6000 : 4000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      if (!result || !result.content || result.content.length === 0) {
        throw new Error('Claude API returned empty response');
      }
      
      let generatedContent = result.content[0].text.trim();
      
      // Удаляем служебный текст в тройных обратных кавычках (```)
      generatedContent = generatedContent.replace(/```[\s\S]*?```/g, '');
      
      // Удаляем лишние разделители --- в начале и конце текста
      generatedContent = generatedContent.replace(/^---\s*\n?/g, ''); // Удаляем --- в начале
      generatedContent = generatedContent.replace(/\n?\s*---\s*$/g, ''); // Удаляем --- в конце
      generatedContent = generatedContent.trim(); // Убираем лишние пробелы
      
      logger.log('Content successfully generated with Claude AI', 'claude');
      return generatedContent;
    } catch (error) {
      logger.error('Error generating content with Claude:', error, 'claude');
      throw new Error('Failed to generate content with Claude: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * Генерирует контент для социальных сетей на основе ключевых слов и инструкций
   * @param keywords Ключевые слова для включения в контент
   * @param prompt Дополнительные инструкции/контекст для генерации
   * @param params Параметры для настройки генерации
   * @returns Сгенерированный текст
   */
  async generateSocialContent(
    keywords: string[],
    prompt: string,
    params: SocialContentParams = {}
  ): Promise<string> {
    logger.log(`Generating social content with Claude AI for platform: ${params.platform || 'general'}`, 'claude');
    
    if (!this.apiKey) {
      throw new Error('Claude API key is not configured');
    }
    
    const { 
      platform = 'general',
      tone = 'informative',
      maxTokens = 4000, // Проверяем, что не превышает 8192
      temperature = 0.7,
      model = this.defaultModel
    } = params;
    
    try {
      // Создаем детальный промпт для социальных сетей с учетом платформы
      const socialPrompt = this.createSocialPrompt(keywords, prompt, platform, tone);
      
      const result = await this.makeRequest({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: socialPrompt
          }
        ]
      });
      
      if (!result || !result.content || result.content.length === 0) {
        throw new Error('Claude API returned empty response');
      }
      
      let generatedContent = result.content[0].text.trim();
      
      // Удаляем служебный текст в тройных обратных кавычках (```)
      generatedContent = generatedContent.replace(/```[\s\S]*?```/g, '');
      
      // Удаляем лишние разделители --- в начале и конце текста
      generatedContent = generatedContent.replace(/^---\s*\n?/g, ''); // Удаляем --- в начале
      generatedContent = generatedContent.replace(/\n?\s*---\s*$/g, ''); // Удаляем --- в конце
      generatedContent = generatedContent.trim(); // Убираем лишние пробелы
      
      // Форматируем контент в зависимости от платформы
      const formattedContent = this.formatContentForPlatform(generatedContent, platform);
      
      logger.log('Social content successfully generated with Claude AI', 'claude');
      return formattedContent;
    } catch (error) {
      logger.error('Error generating social content with Claude:', error, 'claude');
      throw new Error('Failed to generate social content with Claude: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * Создает промпт для генерации контента для социальных сетей
   */
  private createSocialPrompt(keywords: string[], userPrompt: string, platform: string, tone: string): string {
    const keywordsText = keywords.join(", ");
    
    // Базовый шаблон промпта
    let prompt = `Ты - профессиональный SMM-копирайтер и специалист по созданию популярного контента.
Твоя задача - написать интересный и вовлекающий пост для ${platform === 'general' ? 'социальных сетей' : platform}.

Ключевые слова, которые нужно использовать: ${keywordsText}.

Тон и стиль: ${tone}.

Инструкции пользователя: ${userPrompt}

`;

    // Добавляем специфичные инструкции в зависимости от платформы
    switch(platform) {
      case 'telegram':
        prompt += `
Особенности для Telegram:
- Используй эмодзи для структурирования текста и добавления эмоций
- Текст может быть длиннее, чем для других соцсетей (до 4000 символов)
- Можно использовать форматирование: *жирный*, _курсив_, __подчеркнутый__, ~зачеркнутый~
- Создай заголовок, который будет привлекать внимание`;
        break;
      case 'instagram':
        prompt += `
Особенности для Instagram:
- Сделай текст визуально привлекательным, используй эмодзи
- Разбивай текст на абзацы, используй пробелы для лучшей читаемости
- Добавь хэштеги в конце поста (не более 10)
- В первых 2-3 предложениях должна быть суть поста, чтобы привлечь внимание`;
        break;
      case 'facebook':
        prompt += `
Особенности для Facebook:
- Более развернутый текст, чем для Instagram
- Добавь призыв к действию (поделиться, прокомментировать)
- Используй эмодзи умеренно
- Сделай текст удобным для чтения с мобильных устройств`;
        break;
      case 'vk':
        prompt += `
Особенности для ВКонтакте:
- Используй неформальный, но грамотный стиль
- Добавь эмодзи для структурирования текста
- Добавь хэштеги (не более 5-7)
- Сделай текст эмоционально привлекательным`;
        break;
      default:
        prompt += `
Общие рекомендации:
- Сделай текст структурированным и легким для чтения
- Используй заголовок, привлекающий внимание
- Разбивай информацию на абзацы
- Используй эмодзи, если это уместно для стиля
- Добавь призыв к действию в конце поста`;
    }

    // Дополнительные инструкции для правильного форматирования
    prompt += `

ВАЖНО:
1. Не используй маркеры, нумерованные списки или другие форматирующие элементы, которые не поддерживаются в социальных сетях
2. Создай только текст поста, без метаинформации, комментариев или пояснений
3. Текст должен быть готов к публикации без дополнительного редактирования
4. Не включай в ответ следующие фразы: "Вот пост для...", "Пост для социальных сетей", "Хэштеги:" и т.п.
5. Пиши исключительно на русском языке

Создай пост прямо сейчас:`;

    return prompt;
  }
  
  /**
   * Форматирует сгенерированный контент под конкретную платформу
   */
  private formatContentForPlatform(content: string, platform: string): string {
    // Общая постобработка для всех платформ
    let formattedContent = content
      .replace(/^["'](.+)["']$/gm, '$1') // Удаляем кавычки в начале и конце строк
      .replace(/^(пост для|вот пост для|контент для|публикация для|текст для)\s+[\w\s]+:\s*/i, '') // Удаляем преамбулу
      .trim();
    
    // Специфическая постобработка для разных платформ
    switch(platform) {
      case 'telegram':
        // Преобразование маркированных и нумерованных списков в Telegram-совместимый формат
        formattedContent = formattedContent
          .replace(/^-\s+(.+)$/gm, '• $1') // Заменяем маркеры списка на символ точки
          .replace(/^(\d+)[\.\)]\s+(.+)$/gm, '$1. $2'); // Форматируем нумерованный список
        break;
      case 'instagram':
        // Добавляем пробелы между абзацами для лучшей читаемости в Instagram
        formattedContent = formattedContent
          .replace(/\n+/g, '\n\n')
          .replace(/(\#[\wа-яА-Я]+)([^\s])/g, '$1 $2'); // Добавляем пробелы между хэштегами
        break;
      case 'vk':
        // ВКонтакте не поддерживает специальное форматирование
        formattedContent = formattedContent;
        break;
      case 'facebook':
        // Facebook имеет минимальное форматирование
        formattedContent = formattedContent;
        break;
      default:
        // Общий формат по умолчанию
        formattedContent = formattedContent;
    }
    
    return formattedContent;
  }
  
  /**
   * Выполняет запрос к Claude API
   */
  private async makeRequest(requestData: ClaudeRequest): Promise<ClaudeResponse> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 секунда
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.apiKey) {
          throw new Error('Claude API key is not configured');
        }
        
        logger.debug(`Making Claude API request to ${this.apiUrl} (попытка ${attempt}/${maxRetries})`, 'claude');
        logger.debug(`Using model: ${requestData.model}`, 'claude');
        
        // ДИАГНОСТИКА СЕТИ для выявления разности между Replit и стейджем
        const maskedKey = this.apiKey.substring(0, 8) + '...' + this.apiKey.substring(this.apiKey.length - 4);
        console.log(`[NETWORK-DEBUG] Claude API call environment check:`);
        console.log(`[NETWORK-DEBUG] - API URL: ${this.apiUrl}`);
        console.log(`[NETWORK-DEBUG] - API Key (masked): ${maskedKey}`);
        console.log(`[NETWORK-DEBUG] - Model: ${requestData.model}`);
        console.log(`[NETWORK-DEBUG] - User-Agent: SMM-Manager/1.0`);
        console.log(`[NETWORK-DEBUG] - NODE_ENV: ${process.env.NODE_ENV}`);
        console.log(`[NETWORK-DEBUG] - Server IP attempt detection...`);
        
        // Вывод заголовков (без API ключа)
        logger.debug('Request headers: Content-Type: application/json, anthropic-version: 2023-06-01', 'claude');
        
        // Первые 20 символов содержимого запроса для логирования
        const contentPreview = requestData.messages[0].content.substring(0, 20) + '...';
        logger.debug(`Request content preview: ${contentPreview}`, 'claude');
        
        const response = await axios.post<ClaudeResponse>(
          this.apiUrl,
          requestData,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': '2023-06-01',
              'User-Agent': 'SMM-Manager/1.0'
            },
            timeout: 60000, // Увеличиваем таймаут до 60 секунд
            validateStatus: function (status) {
              return status < 500; // Принимаем 4xx статусы для детального анализа
            }
          }
        );
        
        if (response.status !== 200) {
          console.log(`[NETWORK-DEBUG] Claude API non-200 response:`);
          console.log(`[NETWORK-DEBUG] - Status: ${response.status}`);
          console.log(`[NETWORK-DEBUG] - Response data: ${JSON.stringify(response.data)}`);
          console.log(`[NETWORK-DEBUG] - Response headers: ${JSON.stringify(response.headers)}`);
          
          if (response.status === 403) {
            throw new Error(`Request not allowed (403). Environment: ${process.env.NODE_ENV}. Response: ${JSON.stringify(response.data)}`);
          } else if (response.status === 401) {
            throw new Error(`Invalid API key (401). Response: ${JSON.stringify(response.data)}`);
          } else {
            throw new Error(`Claude API responded with status code ${response.status}. Response: ${JSON.stringify(response.data)}`);
          }
        }
        
        logger.debug(`Claude API response received with status: ${response.status}`, 'claude');
        if (attempt > 1) {
          logger.log(`Claude API успешно ответил с попытки ${attempt}`, 'claude');
        }
        
        return response.data;
        
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          const status = error.response.status;
          logger.error(`Claude API error: ${status}`, 'claude');
          
          // Если ошибка 529 (перегрузка сервера) и есть еще попытки
          if (status === 529 && attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1); // Экспоненциальная задержка
            logger.log(`Claude API перегружен (529), повторная попытка ${attempt + 1}/${maxRetries} через ${delay}ms`, 'claude');
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // Расширенное логирование ошибок по статус-кодам
          if (status === 401) {
            logger.error('Claude API rejected request: Invalid API key or permissions (401)', 'claude');
          } else if (status === 400) {
            console.log('Claude API 400 Error Details:', JSON.stringify(error.response.data, null, 2));
            console.log('Request data model:', requestData.model);
            console.log('Request data max_tokens:', requestData.max_tokens);
            console.log('Request data messages:', JSON.stringify(requestData.messages, null, 2));
            logger.error(`Claude API rejected request: Bad request (400)`, 'claude');
            logger.error(`Error details: ${JSON.stringify(error.response.data, null, 2)}`, 'claude');
            logger.error(`Request data model: ${requestData.model}`, 'claude');
            logger.error(`Request data max_tokens: ${requestData.max_tokens}`, 'claude');
            logger.error(`Request data messages length: ${requestData.messages.length}`, 'claude');
            if (requestData.messages[0]) {
              logger.error(`First message role: ${requestData.messages[0].role}`, 'claude');
              logger.error(`First message content length: ${requestData.messages[0].content.length}`, 'claude');
            }
          } else if (status === 429) {
            logger.error('Claude API rejected request: Rate limit exceeded (429)', 'claude');
          } else if (status >= 500) {
            logger.error(`Claude API server error (${status}). Please try again later.`, 'claude');
          }
          
          // Если это последняя попытка, выбрасываем ошибку
          if (attempt === maxRetries) {
            throw error;
          }
        } else {
          logger.error('Error making Claude API request:', error, 'claude');
          
          // Если это последняя попытка или ошибка не связана с сетью
          if (attempt === maxRetries) {
            throw error;
          }
          
          // Повторяем попытку для сетевых ошибок
          const delay = baseDelay * Math.pow(2, attempt - 1);
          logger.log(`Ошибка сети Claude API, повторная попытка ${attempt + 1}/${maxRetries} через ${delay}ms`, 'claude');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error('Claude API недоступен после всех попыток');
  }
}

// Экспортируем singleton экземпляр для совместимости
export const claudeService = new ClaudeService();