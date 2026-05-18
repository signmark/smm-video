import { log } from '../utils/logger.js';
import { geminiVertexDirect } from './gemini-vertex-direct';

/**
 * Сервис для работы с моделями Gemini 2.5
 * Использует доступные модели через Generative Language API
 */
export class GeminiVertexService {

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
        log(`[gemini-vertex] Используем Vertex AI для модели: ${model}`, 'info');
        return await this.tryVertexAI(text, prompt, model);
      } else {
        log(`[gemini-vertex] Используем стандартный API для модели: ${model}`, 'info');
        return await this.tryStandardAPI(text, prompt, model);
      }
      
    } catch (error) {
      log(`[gemini-vertex] Ошибка при улучшении текста: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Пытается использовать Vertex AI для модели 2.5
   */
  private async tryVertexAI(text: string, prompt: string, model: string): Promise<string> {
    try {
      // Импортируем Vertex AI auth
      const { vertexAIAuth } = await import('./vertex-ai-auth.js');
      
      // Получаем токен доступа для Vertex AI
      const accessToken = await vertexAIAuth.getAccessToken();
      
      // Определяем project ID из SERVICE_ACCOUNT_KEY
      const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      if (!serviceAccountKey) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY не настроен');
      }
      
      const credentials = JSON.parse(serviceAccountKey);
      const projectId = credentials.project_id;
      
      // Формируем URL для Vertex AI API
      const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
      
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
      
      log(`[gemini-vertex] Запрос к Vertex AI: ${url}`, 'info');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestData)
      });
      
      const responseText = await response.text();
      log(`[gemini-vertex] Ответ Vertex AI (${response.status}): ${responseText.substring(0, 500)}`, 'info');
      
      if (!response.ok) {
        throw new Error(`Vertex AI HTTP error ${response.status}: ${responseText}`);
      }
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        log(`[gemini-vertex] Ошибка парсинга JSON: ${responseText}`, 'error');
        throw new Error(`Неверный формат ответа от Vertex AI`);
      }
      
      if (responseData.candidates && responseData.candidates.length > 0 && 
          responseData.candidates[0].content && 
          responseData.candidates[0].content.parts && 
          responseData.candidates[0].content.parts.length > 0) {
        
        let resultText = responseData.candidates[0].content.parts[0].text || '';
        resultText = resultText.trim();
        
        log(`[gemini-vertex] Текст успешно улучшен через Vertex AI`, 'info');
        return resultText;
      } else {
        throw new Error('Некорректный формат ответа от Vertex AI');
      }
      
    } catch (error) {
      log(`[gemini-vertex] Ошибка при использовании Vertex AI: ${(error as Error).message}`, 'error');
      throw new Error(`Vertex AI недоступен для модели ${model}: ${(error as Error).message}`);
    }
  }

  /**
   * Использует Vertex AI для всех моделей
   */
  private async tryStandardAPI(text: string, prompt: string, model: string): Promise<string> {
    try {
      log(`[gemini-vertex] Используем Vertex AI для модели: ${model}`, 'info');
      return await geminiVertexDirect.improveText({ text, prompt, model });
    } catch (error) {
      log(`[gemini-vertex] Ошибка при использовании Vertex AI: ${(error as Error).message}`, 'error');
      throw error;
    }
  }
  
  /**
   * Генерирует текст с помощью Gemini
   */
  async generateText(params: { prompt: string; model?: string }): Promise<string> {
    try {
      const { prompt, model = 'gemini-3-pro-preview' } = params;
      
      // Проверяем, является ли это моделью 2.5
      if (this.isGemini25Model(model)) {
        log(`[gemini-vertex] Используем Vertex AI для генерации с моделью: ${model}`, 'info');
        return await this.generateWithVertexAI(prompt, model);
      } else {
        log(`[gemini-vertex] Используем стандартный API для генерации с моделью: ${model}`, 'info');
        return await this.generateWithStandardAPI(prompt, model);
      }
      
    } catch (error) {
      log(`[gemini-vertex] Ошибка при генерации текста: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Генерирует текст через Vertex AI для модели 2.5
   */
  private async generateWithVertexAI(prompt: string, model: string): Promise<string> {
    try {
      // Импортируем Vertex AI auth
      const { vertexAIAuth } = await import('./vertex-ai-auth.js');
      
      // Получаем токен доступа для Vertex AI
      const accessToken = await vertexAIAuth.getAccessToken();
      
      // Определяем project ID из SERVICE_ACCOUNT_KEY
      const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      if (!serviceAccountKey) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY не настроен');
      }
      
      const credentials = JSON.parse(serviceAccountKey);
      const projectId = credentials.project_id;
      
      // Формируем URL для Vertex AI API
      const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
      
      const requestData = {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 8192
        }
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vertex AI HTTP error ${response.status}: ${errorText}`);
      }
      
      const responseData = await response.json();
      
      if (responseData.candidates && responseData.candidates.length > 0 && 
          responseData.candidates[0].content && 
          responseData.candidates[0].content.parts && 
          responseData.candidates[0].content.parts.length > 0) {
        
        let resultText = responseData.candidates[0].content.parts[0].text || '';
        resultText = resultText.trim();
        
        log(`[gemini-vertex] Текст успешно сгенерирован через Vertex AI`, 'info');
        return resultText;
      } else {
        throw new Error('Некорректный формат ответа от Vertex AI');
      }
      
    } catch (error) {
      log(`[gemini-vertex] Ошибка при генерации через Vertex AI: ${(error as Error).message}`, 'error');
      throw new Error(`Vertex AI недоступен для модели ${model}: ${(error as Error).message}`);
    }
  }

  /**
   * Генерирует текст через Vertex AI для всех моделей
   */
  private async generateWithStandardAPI(prompt: string, model: string): Promise<string> {
    try {
      log(`[gemini-vertex] Используем Vertex AI для генерации с моделью: ${model}`, 'info');
      return await geminiVertexDirect.generateContent({ prompt, model });
    } catch (error) {
      log(`[gemini-vertex] Ошибка при генерации через Vertex AI: ${(error as Error).message}`, 'error');
      throw error;
    }
  }
}

export const geminiVertexService = new GeminiVertexService();