import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import * as logger from '../utils/logger';

interface VertexAIConfig {
  projectId: string;
  location: string;
  credentials: any;
}

interface GenerateRequest {
  prompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Сервис для работы с Google Vertex AI Gemini 2.5 моделями
 */
export class VertexAIService {
  private config: VertexAIConfig;
  private auth: GoogleAuth;
  private projectId: string;
  private location: string;

  constructor(config: VertexAIConfig) {
    this.config = config;
    this.projectId = config.projectId;
    this.location = config.location || 'us-central1';
    
    // Инициализация Google Auth с Service Account
    this.auth = new GoogleAuth({
      credentials: config.credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    
    logger.log(`[vertex-ai] Инициализирован Vertex AI для проекта: ${this.projectId}`);
  }

  /**
   * Получает токен доступа для Vertex AI API
   */
  private async getAccessToken(): Promise<string> {
    try {
      // Получаем токен доступа напрямую через auth клиент
      const authClient = await this.auth.getClient();
      const accessTokenResponse = await authClient.getAccessToken();
      
      if (!accessTokenResponse.token) {
        throw new Error('Токен доступа не получен от Google Auth');
      }
      
      logger.log(`[vertex-ai] Токен доступа получен успешно`);
      return accessTokenResponse.token;
    } catch (error) {
      logger.error('[vertex-ai] Ошибка получения токена доступа:', error);
      logger.error('[vertex-ai] Детали ошибки:', JSON.stringify(error, null, 2));
      throw new Error(`Не удалось получить токен доступа для Vertex AI: ${(error as Error).message}`);
    }
  }

  /**
   * Генерирует текст с помощью Gemini 2.5 моделей через Vertex AI
   */
  async generateText(request: GenerateRequest): Promise<string> {
    try {
      const { prompt, model, maxTokens = 8192, temperature = 0.7 } = request;
      
      logger.log(`[vertex-ai] Генерация текста с моделью: ${model}`);
      
      const accessToken = await this.getAccessToken();
      const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent`;
      
      const payload = {
        contents: [{
          role: 'user',
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: 0.8,
          topK: 40
        }
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[vertex-ai] Ошибка API (${response.status}):`, errorText);
        throw new Error(`Vertex AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Универсальная обработка ответов от Vertex AI
      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        
        // Проверяем причину завершения
        if (candidate.finishReason === 'MAX_TOKENS') {
          logger.warn('[vertex-ai] Достигнут лимит токенов, текст может быть обрезан');
          if (data.usageMetadata) {
            logger.log(`[vertex-ai] Использование токенов:`, data.usageMetadata);
          }
        }
        
        // Извлекаем текст из разных возможных структур
        let generatedText = '';
        
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          // Стандартная структура с content.parts
          generatedText = candidate.content.parts[0].text;
        } else if (candidate.parts && candidate.parts.length > 0) {
          // Альтернативная структура с прямыми parts
          generatedText = candidate.parts[0].text;
        } else if (candidate.text) {
          // Прямое текстовое поле
          generatedText = candidate.text;
        } else {
          logger.error('[vertex-ai] Не найден текст в ответе candidate:', JSON.stringify(candidate, null, 2));
          throw new Error('Не удалось извлечь текст из ответа Vertex AI');
        }
        
        if (generatedText) {
          logger.log(`[vertex-ai] Успешно сгенерирован текст длиной: ${generatedText.length} символов`);
          return generatedText;
        } else {
          throw new Error('Пустой текст в ответе от Vertex AI');
        }
      } else {
        logger.error('[vertex-ai] Нет candidates в ответе:', JSON.stringify(data, null, 2));
        throw new Error('Отсутствуют candidates в ответе от Vertex AI');
      }
      
    } catch (error) {
      logger.error('[vertex-ai] Ошибка генерации текста:', error);
      throw error;
    }
  }

  /**
   * Проверяет доступность Vertex AI API
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.log('[vertex-ai] Проверка подключения к Vertex AI...');
      
      const result = await this.generateText({
        prompt: 'Скажи "тест"',
        model: 'gemini-3-pro-preview'
      });
      
      logger.log('[vertex-ai] Подключение к Vertex AI успешно');
      return true;
    } catch (error) {
      logger.error('[vertex-ai] Ошибка подключения к Vertex AI:', error);
      return false;
    }
  }

  /**
   * Получает список доступных моделей Gemini 2.5
   */
  getAvailableModels(): string[] {
    return [
      'gemini-2.5-flash',
      'gemini-2.5-pro'
    ];
  }
}

// Фабрика для создания экземпляра VertexAIService
export function createVertexAIService(projectId: string, credentials: any, location: string = 'us-central1'): VertexAIService {
  return new VertexAIService({
    projectId,
    location,
    credentials
  });
}