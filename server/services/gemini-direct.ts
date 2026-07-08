/**
 * Gemini Direct — замена geminiVertexDirect через Cloudflare Worker прокси.
 * Предоставляет тот же интерфейс generateContent(), но использует
 * обычный Gemini API через GEMINI_PROXY_URL вместо Vertex AI.
 */

import { log } from '../utils/logger';

interface GenerateContentOptions {
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

interface GenerateContentResult {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

class GeminiDirect {
  private readonly defaultModel = 'gemini-2.5-flash';

  async generateContent(options: GenerateContentOptions): Promise<GenerateContentResult> {
    const { prompt, model = this.defaultModel, temperature = 0.7, maxOutputTokens = 8192, systemInstruction } = options;

    // Получаем API ключ
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const { globalApiKeysService } = await import('./global-api-keys');
      const { ApiServiceName } = await import('./api-keys');
      apiKey = await globalApiKeysService.getGlobalApiKey(ApiServiceName.GEMINI) || undefined;
    }
    if (!apiKey) throw new Error('GEMINI_API_KEY не настроен');

    // Формируем URL через Cloudflare Worker прокси
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const workerProxy = process.env.GEMINI_PROXY_URL;
    if (workerProxy) {
      try {
        const proxyUrl = new URL(workerProxy);
        const originalUrl = new URL(url);
        originalUrl.host = proxyUrl.host;
        originalUrl.protocol = proxyUrl.protocol;
        url = originalUrl.toString();
      } catch { /* ignore bad proxy URL */ }
    }

    const contents: any[] = [{ role: 'user', parts: [{ text: prompt }] }];
    const body: any = {
      contents,
      generationConfig: { temperature, maxOutputTokens },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API ${response.status}: ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const usage = data?.usageMetadata;

      return {
        text,
        model,
        usage: usage ? {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        } : undefined,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async improveText(text: string, instruction: string = 'Улучши текст'): Promise<string> {
    const result = await this.generateContent({
      prompt: `${instruction}:\n\n${text}`,
      model: 'gemini-2.5-flash',
    });
    return result.text;
  }
}

export const geminiDirect = new GeminiDirect();
