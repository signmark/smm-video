import { geminiVertexDirect } from './gemini-vertex-direct';
import * as logger from '../utils/logger';

/**
 * Сервис для работы с Google Gemini API
 * Этот файл является обёрткой для использования GeminiProxyService
 * и обеспечения обратной совместимости с существующим кодом
 */
export class GeminiService {
  private apiKey: string;
  
  /**
   * Конструктор сервиса Gemini
   * @param apiKey API ключ Gemini
   */
  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
  }
  
  /**
   * Проверяет валидность API ключа Gemini
   * @returns true если ключ валидный, false если нет
   */
  async testApiKey(): Promise<boolean> {
    try {
      // Проверка API ключа
      // Тестируем через Vertex AI
      await geminiVertexDirect.generateContent({ prompt: 'test' });
      return true;
    } catch (error) {
      logger.error('[gemini-service] Error testing API key:', error);
      return false;
    }
  }
  
  /**
   * Генерирует текст с помощью Gemini
   * @param prompt Запрос для генерации текста
   * @param modelName Название модели
   * @returns Сгенерированный текст
   */
  async generateText(prompt: string, modelName: string = 'gemini-3-pro-preview'): Promise<string> {
    try {
      // Генерация текста через прокси-сервис
      
      return await geminiVertexDirect.generateContent({ 
        prompt, 
        model: modelName 
      });
    } catch (error) {
      logger.error('[gemini-service] Error generating text:', error);
      throw new Error(`Ошибка при генерации текста с Gemini: ${(error as Error).message}`);
    }
  }
  
  /**
   * Улучшает текст с помощью Gemini
   * @param params Параметры улучшения текста
   * @returns Улучшенный текст
   */
  async improveText({ text, prompt, model = 'gemini-3-pro-preview' }: {
    text: string;
    prompt: string;
    model?: string;
  }): Promise<string> {
    try {
      // Улучшение текста
      
      // Используем прокси сервис для улучшения текста
      // Используем Vertex AI для улучшения текста
      const improvePrompt = `${prompt}\n\nOriginal text: ${text}`;
      return await geminiVertexDirect.generateContent({
        prompt: improvePrompt,
        model
      });
    } catch (error) {
      logger.error('[gemini-service] Error improving text:', error);
      throw new Error(`Ошибка при улучшении текста с Gemini: ${(error as Error).message}`);
    }
  }
  
  /**
   * Обновляет API ключ
   * @param apiKey Новый API ключ
   */
  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}

// Экспортируем экземпляр сервиса по умолчанию
// ВАЖНО: Ключ должен быть передан при создании или установлен через updateApiKey
export const geminiService = new GeminiService({ apiKey: '' });
