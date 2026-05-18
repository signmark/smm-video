/**
 * API для административных операций
 */

import express from 'express';
import { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

// Создаем маршрут для административных операций
export const adminApiRoutes = express.Router();

// API для получения актуального токена администратора
adminApiRoutes.get('/current-admin-token', async (req: Request, res: Response) => {
  try {
    const directusUrl = process.env.DIRECTUS_URL;
    const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
    const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    // Получаем новый токен администратора
    const authResponse = await axios.post(`${directusUrl}/auth/login`, {
      email: adminEmail,
      password: adminPassword
    });
    
    const token = authResponse.data.data.access_token;
    
    // Возвращаем только первые 10 символов для безопасности
    res.json({ 
      success: true, 
      tokenPrefix: token.substring(0, 10) + '...',
      tokenLength: token.length,
      fullToken: token // Только для отладки
    });
  } catch (error: any) {
    log(`Ошибка при получении токена: ${error.message}`);
    
    if (error.response) {
      log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Не удалось получить токен',
      details: error.message,
      responseData: error.response?.data
    });
  }
});