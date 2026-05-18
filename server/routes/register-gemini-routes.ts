import { Express } from 'express';
import { geminiRouter } from './gemini-routes';
import * as logger from '../utils/logger';

/**
 * Регистрирует маршруты для работы с Gemini API через SOCKS5 прокси
 * @param app Express приложение
 */
export function registerGeminiRoutes(app: Express): void {
  // Регистрируем основные маршруты Gemini API
  app.use('/api/gemini', geminiRouter);
  logger.log('Маршруты Gemini API с SOCKS5 прокси регистрированы');
}