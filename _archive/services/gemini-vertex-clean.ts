import { log } from '../utils/logger.js';
import { globalApiKeysService } from './global-api-keys';

/**
 * Сервис для работы с Gemini через Vertex AI с чистыми credentials из Директус
 */
export class GeminiVertexClean {
  private projectId?: string;
  private location = 'us-central1';
  private isInitialized = false;

  /**
   * Инициализирует project ID из GlobalApiKeysService
   */
  private async initializeProjectId(): Promise<void> {
    if (this.isInitialized && this.projectId) {
      return;
    }

    try {
      const credentials = await globalApiKeysService.getVertexAIServiceAccount();
      
      if (!credentials || !credentials.project_id) {
        throw new Error('Vertex AI credentials не найдены в Директус');
      }

      this.projectId = credentials.project_id;
      this.isInitialized = true;
      
      log(`[gemini-vertex-clean] Инициализирован для проекта ${this.projectId}`, 'info');
    } catch (error) {
      log(`[gemini-vertex-clean] Ошибка инициализации project ID: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * Проверяет, является ли модель Gemini 2.5 или 3.0 (требует Vertex AI)
   */
  private isGemini25Model(model: string): boolean {
    return model.includes('2.5') || model.includes('2-5') || model.includes('3.0') || model.includes('3-0');
  }

  /**
   * Улучшает текст с помощью Gemini через Vertex AI
   */
  async improveText(params: { text: string; prompt: string; model?: string }): Promise<string> {
    try {
      const { text, prompt, model = 'gemini-3-pro-preview' } = params;
      
      // Проверяем, является ли это моделью 2.5
      if (this.isGemini25Model(model)) {
        log(`[gemini-vertex-clean] Используем Vertex AI для модели: ${model}`, 'info');
        return await this.tryVertexAI(text, prompt, model);
      } else {
        throw new Error(`Модель ${model} не поддерживается в чистом Vertex AI сервисе`);
      }
      
    } catch (error) {
      log(`[gemini-vertex-clean] Ошибка при улучшении текста: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Пытается использовать Vertex AI для модели 2.5
   */
  private async tryVertexAI(text: string, prompt: string, model: string): Promise<string> {
    try {
      log(`[gemini-vertex-clean] Начинаем запрос к Vertex AI для модели: ${model}`, 'info');
      
      // Импортируем Vertex AI auth
      const { vertexAIAuth } = await import('./vertex-ai-auth.js');
      log(`[gemini-vertex-clean] Vertex AI auth загружен`, 'info');
      
      // Получаем токен доступа для Vertex AI
      log(`[gemini-vertex-clean] Получаем access token`, 'info');
      const accessToken = await vertexAIAuth.getAccessToken();
      
      if (!accessToken) {
        throw new Error('Не удалось получить access token для Vertex AI');
      }
      
      log(`[gemini-vertex-clean] Access token получен: ${accessToken.substring(0, 20)}...`, 'info');
      
      // Инициализируем project ID
      await this.initializeProjectId();
      
      if (!this.projectId) {
        throw new Error('Project ID не инициализирован');
      }
      
      // Формируем URL для Vertex AI API
      const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent`;
      
      const requestData = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${prompt}\n\nТекст для улучшения:\n${text}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192
        }
      };
      
      log(`[gemini-vertex-clean] Запрос к Vertex AI: ${url}`, 'info');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestData),
        signal: AbortSignal.timeout(30000) // 30 секунд таймаут
      });
      
      const responseText = await response.text();
      log(`[gemini-vertex-clean] Ответ Vertex AI (${response.status}): ${responseText.substring(0, 500)}`, 'info');
      
      if (!response.ok) {
        throw new Error(`Vertex AI HTTP error ${response.status}: ${responseText}`);
      }
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        log(`[gemini-vertex-clean] Ошибка парсинга JSON: ${responseText}`, 'error');
        throw new Error('Неверный формат ответа от Vertex AI');
      }
      
      // Извлекаем текст из ответа
      const candidates = responseData.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('Vertex AI не вернул результатов');
      }
      
      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('Vertex AI вернул пустой контент');
      }
      
      const improvedText = content.parts[0].text;
      if (!improvedText) {
        throw new Error('Vertex AI не вернул улучшенный текст');
      }
      
      log(`[gemini-vertex-clean] Текст успешно улучшен через Vertex AI`, 'info');
      return improvedText.trim();
      
    } catch (error) {
      log(`[gemini-vertex-clean] Ошибка Vertex AI: ${(error as Error).message}`, 'error');
      throw new Error(`Vertex AI недоступен для модели ${model}: ${(error as Error).message}`);
    }
  }
}

// Экспортируем экземпляр сервиса
export const geminiVertexClean = new GeminiVertexClean();