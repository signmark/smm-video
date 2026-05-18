import { GoogleAuth } from 'google-auth-library';
import { GlobalApiKeysService } from './global-api-keys.js';

/**
 * Интерфейс для Google Service Account credentials
 */
export interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

/**
 * OAuth2 сервис для получения access токенов для Gemini API
 */
export class GeminiOAuthService {
  private apiKeyService: GlobalApiKeysService;
  private auth: GoogleAuth | null = null;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.apiKeyService = new GlobalApiKeysService();
  }

  /**
   * Инициализация GoogleAuth с Service Account credentials
   */
  private async initializeAuth(): Promise<GoogleAuth> {
    if (this.auth) {
      return this.auth;
    }

    console.log('[GEMINI-OAUTH] 🔑 Инициализация OAuth2 аутентификации для Gemini');

    // Получаем Service Account credentials из Directus
    const credentials = await this.apiKeyService.getGoogleServiceAccountKey();
    
    if (!credentials) {
      throw new Error('Google Service Account credentials не найдены в системе');
    }

    console.log('[GEMINI-OAUTH] ✅ Service Account credentials загружены');
    console.log('[GEMINI-OAUTH] 📧 Client Email:', credentials.client_email);
    console.log('[GEMINI-OAUTH] 🆔 Project ID:', credentials.project_id);

    // Создаем GoogleAuth с credentials и необходимыми scopes
    this.auth = new GoogleAuth({
      credentials: credentials,
      scopes: [
        'https://www.googleapis.com/auth/generative-language',
        'https://www.googleapis.com/auth/cloud-platform'
      ]
    });

    return this.auth;
  }

  /**
   * Получает access token для Gemini API
   * Использует кэширование для избежания лишних запросов
   */
  async getAccessToken(): Promise<string> {
    try {
      // Проверяем кэшированный токен (с запасом 5 минут)
      const now = Date.now() / 1000;
      if (this.cachedToken && this.tokenExpiry > now + 300) {
        console.log('[GEMINI-OAUTH] 📋 Используем кэшированный access token');
        return this.cachedToken;
      }

      console.log('[GEMINI-OAUTH] 🔄 Получаем новый access token');

      // Инициализируем auth если нужно
      const auth = await this.initializeAuth();

      // Получаем authenticated client
      const client = await auth.getClient();
      
      // Получаем access token
      const tokenResponse = await client.getAccessToken();
      
      if (!tokenResponse.token) {
        throw new Error('Не удалось получить access token от Google Auth');
      }

      // Кэшируем токен
      this.cachedToken = tokenResponse.token;
      
      // Устанавливаем время истечения (по умолчанию 1 час)
      this.tokenExpiry = now + 3600; // 1 час

      console.log('[GEMINI-OAUTH] ✅ Access token успешно получен');
      console.log('[GEMINI-OAUTH] ⏰ Token действителен до:', new Date(this.tokenExpiry * 1000).toISOString());

      return this.cachedToken;

    } catch (error) {
      console.error('[GEMINI-OAUTH] ❌ Ошибка получения access token:', error);
      
      // Сбрасываем кэш при ошибке
      this.cachedToken = null;
      this.tokenExpiry = 0;
      
      throw new Error(`Ошибка OAuth2 аутентификации: ${error.message}`);
    }
  }

  /**
   * Принудительно обновляет access token (игнорирует кэш)
   */
  async refreshAccessToken(): Promise<string> {
    console.log('[GEMINI-OAUTH] 🔄 Принудительное обновление access token');
    
    // Очищаем кэш
    this.cachedToken = null;
    this.tokenExpiry = 0;
    
    // Получаем новый токен
    return await this.getAccessToken();
  }

  /**
   * Проверяет валидность текущего токена
   */
  isTokenValid(): boolean {
    const now = Date.now() / 1000;
    return !!(this.cachedToken && this.tokenExpiry > now + 60); // запас 1 минута
  }

  /**
   * Очищает кэшированные данные
   */
  clearCache(): void {
    console.log('[GEMINI-OAUTH] 🧹 Очистка кэша OAuth токена');
    this.cachedToken = null;
    this.tokenExpiry = 0;
    this.auth = null;
  }
}

// Экспортируем синглтон для использования во всем приложении
export const geminiOAuthService = new GeminiOAuthService();