import { log } from '../utils/logger';
import { GoogleAuth } from 'google-auth-library';
import { globalApiKeysService, VertexAIServiceAccount } from './global-api-keys';
import axios from 'axios';

/**
 * Сервис для распознавания речи (Speech-to-Text) через Gemini Vertex AI
 * Использует Gemini 2.5 Flash для транскрибации аудио сообщений
 */
class SpeechToTextService {
  private projectId?: string;
  private location = 'us-central1';
  private credentials?: VertexAIServiceAccount;
  private isInitialized = false;
  private model = 'gemini-3-flash-preview'; // Gemini 3 Flash через global endpoint

  /**
   * Инициализирует credentials из GlobalApiKeysService
   */
  private async initializeCredentials(): Promise<void> {
    if (this.isInitialized && this.credentials) {
      return;
    }

    try {
      log(`[speech-to-text] Получение Google Service Account credentials из Директус`, 'info');
      
      const credentials = await globalApiKeysService.getGoogleServiceAccountKey();
      
      if (!credentials) {
        throw new Error('Google Service Account Key не найден в Директус');
      }

      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Отсутствуют обязательные поля в Vertex AI credentials');
      }

      this.credentials = credentials;
      this.projectId = credentials.project_id;
      this.isInitialized = true;

      log(`[speech-to-text] Успешно инициализирован для проекта ${this.projectId}`, 'info');
    } catch (error) {
      log(`[speech-to-text] Ошибка инициализации credentials: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * Получает access token для Vertex AI API
   */
  private async getAccessToken(): Promise<string> {
    try {
      await this.initializeCredentials();
      
      if (!this.credentials) {
        throw new Error('Credentials не инициализированы');
      }
      
      log(`[speech-to-text] Получаем access token`, 'info');
      
      const auth = new GoogleAuth({
        credentials: this.credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      const client = await auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      
      if (!accessTokenResponse.token) {
        throw new Error('Не удалось получить access token');
      }
      
      return accessTokenResponse.token;
      
    } catch (error) {
      log(`[speech-to-text] Ошибка получения токена: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Транскрибирует аудио в текст через Gemini
   * @param audioBuffer - Buffer с аудио данными
   * @param mimeType - MIME тип аудио (например, 'audio/ogg')
   * @returns Распознанный текст
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    try {
      log(`[speech-to-text] Начинаем транскрибацию аудио (${audioBuffer.length} bytes, ${mimeType})`, 'info');
      
      // Получаем токен доступа
      const accessToken = await this.getAccessToken();
      
      await this.initializeCredentials();
      
      if (!this.projectId) {
        throw new Error('Project ID не инициализирован');
      }
      
      // Конвертируем аудио в base64
      const audioBase64 = audioBuffer.toString('base64');
      
      // Формируем URL для Vertex AI API (global для gemini-3, региональный для остальных)
      const isGlobalModel = this.model.includes('gemini-3');
      const location = isGlobalModel ? 'global' : this.location;
      const endpoint = isGlobalModel ? 'aiplatform.googleapis.com' : `${this.location}-aiplatform.googleapis.com`;
      const url = `https://${endpoint}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${this.model}:generateContent`;
      
      // Формируем запрос с аудио данными
      const requestData = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Transcribe this audio message. Provide only the transcribed text without any additional comments or formatting. If the audio is in Russian, transcribe it in Russian. If it's in English, transcribe in English. Preserve the original language."
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: audioBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1, // Низкая температура для точности
          maxOutputTokens: 2048
        }
      };
      
      log(`[speech-to-text] Отправляем запрос к Gemini API`, 'info');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 секунд таймаут
      
      try {
        const response = await axios.post(url, requestData, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Извлекаем текст из ответа
        const candidates = response.data?.candidates;
        if (!candidates || candidates.length === 0) {
          throw new Error('Gemini вернул пустой ответ');
        }
        
        const text = candidates[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Не удалось извлечь текст из ответа Gemini');
        }
        
        log(`[speech-to-text] Транскрибация успешна, получено ${text.length} символов`, 'info');
        
        return text.trim();
        
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
          throw new Error('Timeout при транскрибации аудио');
        }
        
        if (error.response) {
          log(`[speech-to-text] Ошибка Gemini API: ${JSON.stringify(error.response.data)}`, 'error');
          throw new Error(`Ошибка Gemini API: ${error.response.data?.error?.message || 'Unknown error'}`);
        }
        
        throw error;
      }
      
    } catch (error: any) {
      log(`[speech-to-text] Ошибка транскрибации: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Скачивает аудио файл по URL
   * @param url - URL аудио файла
   * @returns Buffer с аудио данными
   */
  async downloadAudio(url: string): Promise<Buffer> {
    try {
      // БЕЗОПАСНОСТЬ: НЕ логируем URL чтобы не раскрыть токен бота
      log(`[speech-to-text] Скачиваем аудио файл из Telegram`, 'info');
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000 // 30 секунд на скачивание
      });
      
      const buffer = Buffer.from(response.data);
      log(`[speech-to-text] Аудио файл скачан: ${buffer.length} bytes`, 'info');
      
      return buffer;
      
    } catch (error: any) {
      log(`[speech-to-text] Ошибка скачивания аудио: ${error.message}`, 'error');
      throw new Error(`Не удалось скачать аудио файл: ${error.message}`);
    }
  }

  /**
   * Транскрибирует аудио по URL
   * @param audioUrl - URL аудио файла
   * @param mimeType - MIME тип аудио
   * @returns Распознанный текст
   */
  async transcribeAudioFromUrl(audioUrl: string, mimeType: string = 'audio/ogg'): Promise<string> {
    const audioBuffer = await this.downloadAudio(audioUrl);
    return this.transcribeAudio(audioBuffer, mimeType);
  }
}

// Экспортируем синглтон
export const speechToTextService = new SpeechToTextService();
