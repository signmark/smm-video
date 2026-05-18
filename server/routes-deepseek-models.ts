import { Router, Request, Response } from 'express';
import axios from 'axios';
import { apiKeyService } from './services/api-keys';
import { log } from './utils/logger';

export function registerDeepSeekModelsRoute(app: Router) {
  const router = Router();
  // Монтируем на /api
  app.use('/api', router);

  /**
   * Маршрут для запроса списка моделей из DeepSeek API
   * ПУТЬ БЕЗ /api
   */
  router.get('/deepseek/list-models', async (req: Request, res: Response) => {
    try {
      // Проверяем, что пользователь авторизован
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }

      // Получаем API ключ из сервиса API ключей
      const apiKey = await apiKeyService.getApiKey(req.user.id, 'deepseek');
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API ключ DeepSeek не найден в настройках пользователя',
          needApiKey: true
        });
      }

      log('Получение списка моделей DeepSeek...', 'deepseek-models');
      
      // Отправляем запрос к DeepSeek API для получения списка моделей
      const response = await axios.get('https://api.deepseek.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      log(`Успешно получен список моделей от DeepSeek API: ${JSON.stringify(response.data)}`, 'deepseek-models');

      return res.json({
        success: true,
        models: response.data.data || response.data,
        raw: response.data // Возвращаем необработанный ответ для анализа
      });
    } catch (error: any) {
      log(`Ошибка при получении списка моделей DeepSeek: ${error.message}`, 'deepseek-models');
      
      // Формируем подробное сообщение об ошибке для фронтенда
      let errorMessage = error.message || 'Непредвиденная ошибка при получении списка моделей';
      
      if (error.response?.data) {
        try {
          const errorDetails = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data);
          errorMessage += ` (Статус: ${error.response.status}) Ответ API: ${errorDetails}`;
        } catch (e) {
          errorMessage += ` (Статус: ${error.response.status}) [Не удалось извлечь детали ошибки]`;
        }
      }
      
      return res.status(500).json({ 
        success: false, 
        error: errorMessage
      });
    }
  });

  return router;
}