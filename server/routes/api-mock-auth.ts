/**
 * Маршруты для тестовой аутентификации без Directus
 * Используются только для отладки, когда Directus недоступен
 */

import express, { Request, Response } from 'express';
import { log } from '../utils/logger';

// Создаем роутер для тестовой аутентификации
export const mockAuthRouter = express.Router();

// Тестовый пользователь для отладки
const TEST_USER = {
  id: "test-user-id-123456",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
  token: "test-token-for-development-only",
  role: "admin"
};

/**
 * POST /api/mock-auth/login
 * Тестовый вход в систему без Directus
 */
mockAuthRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  // Простая проверка учетных данных для тестирования
  if (email && password) {
    log.info(`[mock-auth] Успешный тестовый вход пользователя: ${email}`);
    
    res.json({
      success: true,
      data: {
        user: {
          id: TEST_USER.id,
          email: email,
          first_name: TEST_USER.first_name,
          last_name: TEST_USER.last_name,
          role: TEST_USER.role
        },
        token: TEST_USER.token
      },
      message: "Тестовый вход выполнен успешно. ВНИМАНИЕ: Используется тестовая аутентификация!"
    });
  } else {
    log.warn(`[mock-auth] Неудачная попытка тестового входа`);
    
    res.status(401).json({
      success: false,
      message: "Необходимо указать email и пароль"
    });
  }
});

/**
 * GET /api/mock-auth/me
 * Получение информации о текущем тестовом пользователе
 */
mockAuthRouter.get('/me', (req: Request, res: Response) => {
  // Проверяем токен из заголовка
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    // Для тестирования принимаем любой токен
    log.info(`[mock-auth] Запрос информации о пользователе с тестовым токеном`);
    
    res.json({
      success: true,
      data: {
        id: TEST_USER.id,
        email: TEST_USER.email,
        first_name: TEST_USER.first_name,
        last_name: TEST_USER.last_name,
        role: TEST_USER.role
      }
    });
  } else {
    log.warn(`[mock-auth] Запрос данных пользователя без токена`);
    
    res.status(401).json({
      success: false,
      message: "Требуется авторизация"
    });
  }
});

/**
 * POST /api/mock-auth/logout
 * Тестовый выход из системы
 */
mockAuthRouter.post('/logout', (req: Request, res: Response) => {
  log.info(`[mock-auth] Тестовый выход пользователя`);
  
  res.json({
    success: true,
    message: "Тестовый выход выполнен успешно"
  });
});

/**
 * GET /api/mock-auth/campaigns
 * Получение тестового списка кампаний
 */
mockAuthRouter.get('/campaigns', (req: Request, res: Response) => {
  log.info(`[mock-auth] Запрос тестовых кампаний`);
  
  res.json({
    success: true,
    data: [
      {
        id: "46868c44-c6a4-4bed-accf-9ad07bba790e",
        name: "Тестовая кампания",
        description: "Кампания для тестирования функционала",
        status: "active",
        user_id: TEST_USER.id
      },
      {
        id: "58979d55-d7b5-5cfe-bddf-0be18fa01aff",
        name: "Вторая тестовая кампания",
        description: "Еще одна кампания для тестов",
        status: "active",
        user_id: TEST_USER.id
      }
    ]
  });
});