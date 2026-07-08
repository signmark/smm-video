import { log } from '../utils/logger';
import axios from 'axios';

/**
 * Сервис для распознавания речи (Speech-to-Text) через Gemini API
 * Использует Gemini 2.5 Flash для транскрибации аудио сообщений
 * Работает через Cloudflare Worker прокси (GEMINI_PROXY_URL)
 */
class SpeechToTextService {
  private model = 'gemini-2.5-flash';
  private apiKey?: string;

  private async getApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;

    let key = process.env.GEMINI_API_KEY;
    if (!key) {
      const { globalApiKeysService } = await import('./global-api-keys');
      const { ApiServiceName } = await import('./api-keys');
      key = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI) || undefined;
    }
    if (!key) throw new Error('GEMINI_API_KEY не настроен');
    this.apiKey = key;
    return key;
  }

  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    try {
      log(`[speech-to-text] Начинаем транскрибацию аудио (${audioBuffer.length} bytes, ${mimeType})`, 'info');

      const apiKey = await this.getApiKey();
      const audioBase64 = audioBuffer.toString('base64');

      // Формируем URL через Cloudflare Worker прокси
      let url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
      const workerProxy = process.env.GEMINI_PROXY_URL;
      if (workerProxy) {
        try {
          const proxyUrl = new URL(workerProxy);
          const originalUrl = new URL(url);
          originalUrl.host = proxyUrl.host;
          originalUrl.protocol = proxyUrl.protocol;
          url = originalUrl.toString();
        } catch { /* ignore */ }
      }

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
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      };

      log(`[speech-to-text] Отправляем запрос к Gemini API`, 'info');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await axios.post(url, requestData, {
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

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
        throw error;
      }

    } catch (error) {
      log(`[speech-to-text] Ошибка транскрибации: ${(error as Error).message}`, 'error');
      throw error;
    }
  }
}

export const speechToTextService = new SpeechToTextService();
