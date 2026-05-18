/**
 * Тестовый маршрут для проверки публикации карусели в Instagram
 */

import express, { Request, Response } from 'express';
import { log } from '../utils/logger';
import fetch from 'node-fetch';

export const registerTestInstagramCarouselRoute = (app: express.Express) => {
  
  // Эндпоинт для тестирования публикации карусели в Instagram
  app.post('/api/test/instagram-carousel', async (req: Request, res: Response) => {
    try {
      const { contentId, token } = req.body;
      
      if (!contentId) {
        return res.status(400).json({
          success: false,
          error: 'Не указан ID контента'
        });
      }
      
      log(`[Test Instagram Carousel] Отправка запроса на публикацию карусели для контента ${contentId}`);
      
      // Отправляем запрос на webhook маршрут для Instagram карусели
      // Используем прямой локальный вызов без реферера для Replit
      const apiUrl = process.env.REPLIT_URL 
        ? `${process.env.REPLIT_URL}/api/webhook/instagram-carousel` 
        : 'http://localhost:5000/api/webhook/instagram-carousel';
        
      log(`[Test Instagram Carousel] Отправка запроса на вебхук по URL: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentId, token }),
      });
      
      const result = await response.json();
      
      log(`[Test Instagram Carousel] Ответ от webhook: ${JSON.stringify(result)}`);
      
      return res.json(result);
    } catch (error) {
      log.error(`[Test Instagram Carousel] Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
      return res.status(500).json({ 
        success: false, 
        error: 'Ошибка при тестировании публикации карусели в Instagram' 
      });
    }
  });
  
  log('Тестовый маршрут для Instagram карусели зарегистрирован');
};