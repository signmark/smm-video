/**
 * API маршруты для валидации различных API ключей
 * Используются для проверки токенов и ключей социальных сетей
 */

import { Express, Request, Response } from 'express';
import {
  validateTelegramToken,
  validateVkToken,
  validateInstagramToken,
  validateFacebookToken,
  validateYoutubeApiKey
} from '../services/social-api-validator';
import { log } from '../utils/logger';

/**
 * Регистрирует все маршруты валидации API ключей
 * @param app Express приложение
 */
export function registerValidationRoutes(app: Express): void {
  // Telegram API Token validation
  app.post('/api/validate/telegram', async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена Telegram: ${token.substring(0, 5)}...`, 'api-validation');
      const result = await validateTelegramToken(token);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error('Error validating Telegram token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // VK API Token validation
  app.post('/api/validate/vk', async (req: Request, res: Response) => {
    try {
      const { token, groupId } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена VK: ${token.substring(0, 5)}...${groupId ? ` для группы ${groupId}` : ''}`, 'api-validation');
      const result = await validateVkToken(token, groupId);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error('Error validating VK token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // Instagram API Token validation
  app.post('/api/validate/instagram', async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена Instagram: ${token.substring(0, 5)}...`, 'api-validation');
      const result = await validateInstagramToken(token);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error('Error validating Instagram token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // Facebook API Token validation
  app.post('/api/validate/facebook', async (req: Request, res: Response) => {
    try {
      const { token, pageId } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена Facebook: ${token.substring(0, 5)}...${pageId ? ` для страницы ${pageId}` : ''}`, 'api-validation');
      const result = await validateFacebookToken(token, pageId);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error('Error validating Facebook token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // YouTube API Key validation
  app.post('/api/validate/youtube', async (req: Request, res: Response) => {
    try {
      const { apiKey, channelId } = req.body;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: 'API ключ не указан' });
      }
      
      log(`Валидация API ключа YouTube: ${apiKey.substring(0, 5)}...${channelId ? ` для канала ${channelId}` : ''}`, 'api-validation');
      const result = await validateYoutubeApiKey(apiKey, channelId);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      console.error('Error validating YouTube API key:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  log('API валидационные маршруты зарегистрированы', 'api-validation');
}