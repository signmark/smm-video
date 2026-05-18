import axios from 'axios';
import { apiKeyService } from './api-keys';
import { log } from '../utils/logger';

export interface QwenConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class QwenService {
  private apiKey: string;
  // Поддерживаемые базовые URL для Qwen API
  private readonly baseUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  private readonly compatModes = {
    dashscope: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    openai: 'https://api.openai.com/v1'
  };
  
  // Указываем активную конфигурацию API
  private apiMode: 'dashscope' | 'qwen' | 'openai' = 'dashscope';
  
  /**
   * Метод для перегрузки generateText, принимающий строку вместо массива сообщений
   * @param prompt Промпт в виде строки
   * @param options Дополнительные опции для генерации
   * @returns Сгенерированный текст
   */
  async generateText(prompt: string, options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    top_p?: number;
    stop?: string[];
  }): Promise<string>;
  
  /**
   * Основной метод generateText, принимающий массив сообщений
   * @param messages Массив сообщений для модели
   * @param options Дополнительные опции для генерации
   * @returns Сгенерированный текст
   */
  async generateText(messages: QwenMessage[], options?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stop?: string[];
  }): Promise<string>;
  
  constructor(config?: QwenConfig) {
    this.apiKey = config?.apiKey || process.env.QWEN_API_KEY || '';
  }
  
  /**
   * Обновляет API ключ сервиса
   */
  updateApiKey(newApiKey: string): void {
    if (newApiKey && newApiKey.trim() !== '') {
      this.apiKey = newApiKey;
      console.log("Qwen API key updated from user settings");
    }
  }
  
  /**
   * Проверяет, установлен ли API ключ
   * @returns true, если API ключ установлен, иначе false
   */
  hasApiKey(): boolean {
    return !!(this.apiKey && this.apiKey.trim() !== '');
  }

  /**
   * Отправляет запрос на генерацию текста через Qwen API
   */
  async generateText(messagesOrPrompt: string | QwenMessage[], options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    maxTokens?: number;
    top_p?: number;
    stop?: string[];
  } = {}): Promise<string> {
    // Преобразуем строку в массив сообщений, если передана строка
    const messages: QwenMessage[] = typeof messagesOrPrompt === 'string' 
      ? [{ role: 'user', content: messagesOrPrompt }]
      : messagesOrPrompt;
    try {
      const model = options.model || 'qwen-plus';
      const temperature = options.temperature !== undefined ? options.temperature : 0.3;
      const max_tokens = options.max_tokens || options.maxTokens || 5000;
      const top_p = options.top_p !== undefined ? options.top_p : 0.9;
      
      // Проверяем, что API ключ установлен
      if (!this.apiKey || this.apiKey.trim() === '') {
        console.error('Qwen API key is not set');
        throw new Error('Qwen API ключ не установлен. Пожалуйста, добавьте API ключ в настройках пользователя.');
      }
      
      console.log(`Sending request to Qwen API (model: ${model}, temp: ${temperature})`);
      
      // Получаем активный URL API на основе режима
      const activeBaseUrl = this.compatModes[this.apiMode];
      
      // Добавляем подробное логирование
      console.log(`Using Qwen API URL: ${activeBaseUrl}/chat/completions (mode: ${this.apiMode})`);
      console.log(`Request payload: ${JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        top_p,
        stop: options.stop || null
      }, null, 2)}`);
      
      const response = await axios.post(
        `${activeBaseUrl}/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens,
          top_p,
          stop: options.stop || null
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`Successful response from Qwen API, status ${response.status}`);
      
      if (!response.data?.choices?.[0]?.message?.content) {
        console.error('Invalid response format from Qwen API:', response.data);
        throw new Error('Некорректный ответ от Qwen API. Пожалуйста, проверьте настройки или попробуйте позже.');
      }
      
      let content = response.data.choices[0].message.content;
      
      // Удаляем лишние разделители --- в начале и конце текста
      content = content.replace(/^---\s*\n?/g, ''); // Удаляем --- в начале
      content = content.replace(/\n?\s*---\s*$/g, ''); // Удаляем --- в конце
      
      // Удаляем тройные кавычки в начале и конце текста
      content = content.replace(/^"""\s*\n?/g, ''); // Удаляем """ в начале
      content = content.replace(/\n?\s*"""\s*$/g, ''); // Удаляем """ в конце
      
      content = content.trim(); // Убираем лишние пробелы
      
      return content;
    } catch (error: any) {
      console.error('Error calling Qwen API:', error);
      
      // Проверяем, содержит ли сообщение об ошибке проблемы с API ключом
      if (error.response?.data?.error) {
        const errorMessage = error.response.data.error.message || error.response.data.error;
        
        if (typeof errorMessage === 'string' && 
           (errorMessage.includes('API key') || errorMessage.includes('authentication') || 
            errorMessage.includes('auth') || errorMessage.includes('token') || 
            error.response.status === 401 || error.response.status === 403)) {
          throw new Error('Недействительный API ключ Qwen. Пожалуйста, проверьте ключ в настройках пользователя.');
        }
      }
      
      // Если проблема с доступом к API
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error(`Не удалось подключиться к Qwen API (${this.baseUrl}). Пожалуйста, проверьте подключение к интернету и доступность сервиса.`);
      }
      
      throw new Error(`Ошибка при обращении к Qwen API: ${error.message || 'Неизвестная ошибка'}`);
    }
  }
  
  /**
   * Генерирует контент для социальных сетей на основе ключевых слов и трендов
   */
  async generateSocialContent(
    keywords: string[],
    topics: string[],
    platform: string,
    options: {
      length?: 'short' | 'medium' | 'long',
      tone?: 'professional' | 'casual' | 'friendly' | 'humorous',
      language?: 'ru' | 'en'
    } = {}
  ): Promise<string> {
    const length = options.length || 'medium';
    const tone = options.tone || 'professional';
    const language = options.language || 'ru';
    
    const lengthMap = {
      short: 'короткий (до 100 слов)',
      medium: 'средний (150-200 слов)',
      long: 'длинный (250-300 слов)'
    };
    
    const toneMap = {
      professional: 'профессиональный и информативный',
      casual: 'неформальный и разговорный',
      friendly: 'дружелюбный и вовлекающий',
      humorous: 'с юмором и легкостью'
    };
    
    const langMap = {
      ru: 'на русском языке',
      en: 'на английском языке'
    };
    
    const platformSpecifics = platform === 'instagram' 
      ? 'Обязательно используй эмодзи между абзацами и в конце предложений. Включи 5-7 хэштегов в конце поста.'
      : platform === 'facebook'
        ? 'Используй четкое форматирование текста с абзацами. Добавь 2-3 вопроса для вовлечения аудитории.'
        : platform === 'telegram' 
          ? 'Добавь ссылки и упоминания. Можно использовать эмодзи, но умеренно. Не используй хэштеги.'
          : 'Адаптируй контент для цифровых платформ.';
    
    const systemPrompt = `Ты профессиональный копирайтер для социальных сетей. Твоя задача - создать качественный контент для платформы ${platform} на основе предоставленных ключевых слов и тем.

Создай ${lengthMap[length]} пост ${langMap[language]} с ${toneMap[tone]} тоном.

${platformSpecifics}

В тексте обязательно используй предоставленные ключевые слова органично, без искусственного вставления. Раскрой предоставленные темы, но делай это естественно и интересно для читателя.

ВАЖНО:
- Не упоминай, что текст создан ИИ или для каких-то конкретных целей
- Не используй клише и шаблонные фразы
- Делай текст живым, с естественными переходами между мыслями
- Используй активный залог вместо пассивного`;

    const userContent = `Ключевые слова: ${keywords.join(', ')}
Темы для раскрытия: ${topics.join(', ')}

Создай привлекательный пост для ${platform} ${language === 'ru' ? 'на русском языке' : 'на английском языке'}.`;

    try {
      return await this.generateText(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        {
          temperature: 0.7,  // Более высокая температура для креативности
          max_tokens: length === 'short' ? 300 : length === 'medium' ? 500 : 800
        }
      );
    } catch (error: any) {
      console.error('Error generating social content with Qwen:', error);
      const errorMessage = error.message || 'Неизвестная ошибка при генерации контента';
      log(`Qwen генерация контента не удалась: ${errorMessage}`, 'qwen');
      
      // Форматируем сообщение об ошибке для более понятного отображения пользователю
      if (errorMessage.includes('API ключ')) {
        throw new Error(`Проблема с API ключом Qwen: ${errorMessage}`);
      } else if (errorMessage.includes('подключиться')) {
        throw new Error('Не удалось подключиться к Qwen API. Проверьте соединение или доступность сервиса.');
      } else {
        throw new Error(`Ошибка при генерации контента через Qwen: ${errorMessage}`);
      }
    }
  }
  
  /**
   * Инициализирует сервис с API ключом пользователя из централизованного сервиса API ключей
   * @param userId ID пользователя
   * @param authToken Токен авторизации для Directus (опционально)
   * @returns true в случае успешной инициализации, false в случае ошибки
   */
  async initialize(userId: string, authToken?: string): Promise<boolean> {
    try {
      console.log('Initializing Qwen service for user', userId);
      
      // Используем централизованную систему API ключей
      const apiKey = await apiKeyService.getApiKey(userId, 'qwen', authToken);
      
      if (apiKey) {
        console.log('Qwen API key successfully obtained from API Key Service');
        this.updateApiKey(apiKey);
        log('Qwen API key successfully obtained from API Key Service', 'qwen');
        return true;
      } else {
        console.log('Qwen API key not found for user', userId);
        log('Qwen API key not found in user settings', 'qwen');
        return false;
      }
    } catch (error) {
      console.error('Error initializing Qwen service:', error);
      log(`Error initializing Qwen service: ${error instanceof Error ? error.message : 'unknown error'}`, 'qwen');
      return false;
    }
  }
}

export const qwenService = new QwenService({
  apiKey: ''
});