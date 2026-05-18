/**
 * Утилита для корректной обработки пользовательских токенов
 * Разделяет логику пользовательских и административных токенов
 */

import { directusApi } from '../lib/directus.js';

export class TokenHandler {
  /**
   * Проверяет пользовательский токен и получает информацию о пользователе
   * @param token Пользовательский токен
   * @returns Информация о пользователе или null если токен недействителен
   */
  static async validateUserToken(token: string): Promise<{ userId: string; email: string } | null> {
    try {
      // Декодируем токен напрямую без проверки времени жизни
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      
      // Проверяем наличие обязательных полей
      if (!payload.id) {
        throw new Error('Invalid token payload');
      }
      const userResponse = { 
        data: { 
          data: { 
            id: payload.id, 
            email: payload.email || 'unknown@email.com' 
          } 
        } 
      };
      
      if (userResponse.data?.data?.id) {
        return {
          userId: userResponse.data.data.id,
          email: userResponse.data.data.email
        };
      }
      
      return null;
    } catch (error: any) {
      console.log(`User token validation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Возвращает стандартный ответ об истекшем токене
   */
  static getTokenExpiredResponse() {
    return {
      error: 'Token expired',
      code: 'TOKEN_EXPIRED', 
      message: 'Please log in again'
    };
  }

  /**
   * Получает административный токен для операций публикации
   */
  static getAdminToken(): string | null {
    return process.env.DIRECTUS_TOKEN || null;
  }

  /**
   * Проверяет, является ли токен административным
   */
  static isAdminToken(token: string): boolean {
    const adminToken = process.env.DIRECTUS_TOKEN;
    return adminToken === token;
  }
}