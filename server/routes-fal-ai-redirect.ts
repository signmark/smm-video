/**
 * Модуль перенаправления устаревших маршрутов FAL.AI на новые
 * Обеспечивает совместимость с ранее созданными тестами и интеграциями
 */

import express, { Express } from 'express';

// Создаем маршрутизатор
const router = express.Router();

// Глобальная переменная для хранения экземпляра Express
let expressApp: Express;

export function registerFalAiRedirectRoutes(app: Express) {
  // Сохраняем ссылку на Express приложение для использования в маршрутах
  expressApp = app;
  
  app.use('/', router);
  console.log('[express] FAL.AI redirect routes registered');
}

// Маршрут перенаправления с устаревшего (generate-universal-image) на новый (fal-ai-images)
router.post('/api/generate-universal-image', (req, res) => {
  console.log('[express] [fal-ai-redirect] Получен запрос на универсальную генерацию изображения, модель:', req.body.model);
  
  // Перенаправляем на новый маршрут с сохранением всех параметров
  req.url = '/api/fal-ai-images';
  
  if (expressApp && expressApp._router) {
    expressApp._router.handle(req, res);
  } else {
    console.error('[express] [fal-ai-redirect] Express app не инициализирован');
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера при перенаправлении'
    });
  }
});

export default router;