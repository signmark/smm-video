import { GoogleAuth } from 'google-auth-library';
import { log } from '../utils/logger';
import { globalApiKeysService, VertexAIServiceAccount } from './global-api-keys';

/**
 * Сервис для авторизации в Vertex AI через Service Account
 * Теперь использует GlobalApiKeysService из Директус вместо hardcoded credentials
 */
class VertexAIAuth {
  private auth?: GoogleAuth;
  private projectId?: string;
  private location: string = 'us-central1';
  private credentials?: VertexAIServiceAccount;
  private isInitialized: boolean = false;

  constructor() {
    log(`[vertex-ai-auth] Инициализация сервиса авторизации Vertex AI (ленивая загрузка)`, 'vertex-ai');
  }

  /**
   * Инициализирует авторизацию с credentials из Директус
   */
  private async initializeCredentials(): Promise<void> {
    if (this.isInitialized && this.credentials && this.auth) {
      // Уже инициализирован
      return;
    }

    try {
      log(`[vertex-ai-auth] Получение Vertex AI credentials из Директус`, 'vertex-ai');
      
      // Получаем credentials из GlobalApiKeysService
      const credentials = await globalApiKeysService.getVertexAIServiceAccount();
      
      if (!credentials) {
        throw new Error('Vertex AI Service Account credentials не найдены в Директус');
      }

      if (credentials.type !== 'service_account') {
        throw new Error('Неверный тип credentials: ожидается service_account');
      }

      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Отсутствуют обязательные поля в Vertex AI credentials');
      }

      this.credentials = credentials;
      this.projectId = credentials.project_id;
      
      this.auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });

      this.isInitialized = true;
      log(`[vertex-ai-auth] Успешно инициализирован для проекта ${this.projectId} с client_email ${credentials.client_email}`, 'vertex-ai');
    } catch (error) {
      log(`[vertex-ai-auth] Ошибка инициализации: ${error}`, 'vertex-ai');
      throw new Error(`Не удалось инициализировать Vertex AI авторизацию: ${error}`);
    }
  }

  /**
   * Получает access token для Vertex AI API
   */
  async getAccessToken(): Promise<string | null> {
    try {
      // Убеждаемся, что credentials инициализированы
      await this.initializeCredentials();
      
      if (!this.auth) {
        throw new Error('GoogleAuth не инициализирован');
      }
      
      const client = await this.auth.getClient();
      const accessTokenResponse = await client.getAccessToken();
      
      if (accessTokenResponse.token) {
        log(`[vertex-ai-auth] Получен access token для Vertex AI`, 'vertex-ai');
        return accessTokenResponse.token;
      }
      
      log(`[vertex-ai-auth] Не удалось получить access token`, 'vertex-ai');
      return null;
    } catch (error) {
      log(`[vertex-ai-auth] Ошибка получения access token: ${error}`, 'vertex-ai');
      return null;
    }
  }

  /**
   * Получает ID проекта
   */
  async getProjectId(): Promise<string | null> {
    try {
      await this.initializeCredentials();
      return this.projectId || null;
    } catch (error) {
      log(`[vertex-ai-auth] Ошибка получения project ID: ${error}`, 'vertex-ai');
      return null;
    }
  }

  /**
   * Получает локацию
   */
  getLocation(): string {
    return this.location;
  }

  /**
   * Формирует URL для Vertex AI API
   */
  async getVertexAIUrl(model: string): Promise<string | null> {
    try {
      await this.initializeCredentials();
      
      if (!this.projectId) {
        throw new Error('Project ID не доступен');
      }
      
      const baseUrl = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent`;
      
      // Если задан прокси-воркер Cloudflare, подменяем домен
      const workerProxy = process.env.GEMINI_PROXY_URL;
      if (workerProxy) {
        try {
          const proxyUrl = new URL(workerProxy);
          const originalUrl = new URL(baseUrl);
          originalUrl.host = proxyUrl.host;
          originalUrl.protocol = proxyUrl.protocol;
          log(`[vertex-ai-auth] Using Worker Proxy: ${originalUrl.toString()}`, 'vertex-ai');
          return originalUrl.toString();
        } catch (e) {
          log(`[vertex-ai-auth] Invalid GEMINI_PROXY_URL: ${workerProxy}`, 'error');
        }
      }
      
      return baseUrl;
    } catch (error) {
      log(`[vertex-ai-auth] Ошибка формирования Vertex AI URL: ${error}`, 'vertex-ai');
      return null;
    }
  }
}

// Экспортируем единственный экземпляр
export const vertexAIAuth = new VertexAIAuth();