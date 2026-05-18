import { Express, Request, Response } from "express";
import { deepseekService, DeepSeekService, DeepSeekMessage } from './services/deepseek';
import { apiKeyService } from './services/api-keys';

/**
 * Функция для регистрации тестовых роутов DeepSeek API
 * @param app Express приложение
 */
export function registerDeepSeekTestRoutes(app: Express) {
  
  // Тестовый эндпоинт для проверки API ключа DeepSeek
  app.get('/api/test-deepseek', async (req: Request, res: Response) => {
    try {
      console.log('Тестирование DeepSeek API');
      
      // Проверяем, что пользователь авторизован
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      // Получаем API ключ из параметров запроса или из БД
      let apiKey = req.query.apiKey as string | undefined;
      
      if (!apiKey) {
        // Пытаемся получить ключ из БД
        apiKey = await apiKeyService.getApiKey(req.user.id, 'deepseek');
        
        if (!apiKey) {
          return res.status(400).json({ 
            success: false, 
            error: 'API ключ DeepSeek не предоставлен и не найден в настройках пользователя' 
          });
        }
      }
      
      console.log(`Получен API ключ DeepSeek для тестирования (длина: ${apiKey.length})`);
      
      // Расширенный список форматов ключей для тестирования
      const keyFormats = [
        { description: 'Оригинальный', key: apiKey },
        { description: 'Без префикса Bearer', key: apiKey.replace(/^Bearer\s+/i, '') },
        { description: 'С префиксом Bearer', key: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}` },
        { description: 'С префиксом sk-', key: apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey.replace(/^Bearer\s+/i, '')}` },
        { description: 'Без префикса sk-', key: apiKey.replace(/^Bearer\s+/i, '').replace(/^sk-/i, '') }
      ];
      
      // Проверка каждого формата ключа
      const results = [];
      
      for (const format of keyFormats) {
        try {
          console.log(`Тестирование формата: ${format.description}`);
          
          // Настраиваем временный экземпляр DeepSeek с текущим форматом ключа
          const testService = new DeepSeekService({ apiKey: format.key });
          
          // Простой тестовый запрос
          const testPrompt = await testService.generateText(
            [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "Say hello in one word." }
            ],
            { max_tokens: 10 }
          );
          
          results.push({
            format: format.description,
            success: true,
            result: testPrompt
          });
          
          console.log(`Формат ${format.description} успешно работает: ${testPrompt}`);
        } catch (error: any) {
          console.error(`Ошибка для формата ${format.description}:`, error);
          
          // Формируем более информативное сообщение об ошибке
          let errorMessage = error.message || String(error);
          if (error.response?.status) {
            errorMessage += ` (Статус: ${error.response.status})`;
            if (error.response.data) {
              try {
                const errorDetails = typeof error.response.data === 'string' 
                  ? error.response.data 
                  : JSON.stringify(error.response.data).substring(0, 200);
                errorMessage += ` Ответ API: ${errorDetails}`;
              } catch (e) {
                errorMessage += ' [Не удалось извлечь детали ошибки]';
              }
            }
          }
          
          results.push({
            format: format.description,
            success: false,
            error: errorMessage
          });
        }
      }
      
      // Проверяем, есть ли хотя бы один успешный формат
      const anySuccess = results.some(r => r.success);
      
      // Если есть успешный формат, предлагаем сохранить его в БД
      if (anySuccess) {
        const successFormat = results.find(r => r.success);
        const successIndex = keyFormats.findIndex((_, i) => results[i].success);
        
        if (successIndex > 0) {  // Если это не оригинальный формат
          const successKeyFormat = keyFormats[successIndex];
          
          // Предлагаем сохранение в результатах, но не сохраняем автоматически
          // Пользователь должен сам решить, сохранять или нет
          return res.json({
            success: true,
            results,
            recommendation: {
              message: `Рекомендуем сохранить работающий формат ключа (${successFormat?.format})`,
              apiKey: successKeyFormat.key
            }
          });
        }
      }
      
      // Возвращаем результаты проверки
      return res.json({
        success: anySuccess,
        results,
        message: anySuccess 
          ? 'Найден работающий формат ключа DeepSeek API' 
          : 'Все форматы ключа DeepSeek API не работают'
      });
      
    } catch (error: any) {
      console.error('Ошибка при тестировании DeepSeek API:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Непредвиденная ошибка при тестировании DeepSeek API'
      });
    }
  });
  
  // Сохранение рекомендованного API ключа в БД
  app.post('/api/save-deepseek-key', async (req: Request, res: Response) => {
    try {
      // Проверяем, что пользователь авторизован
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'API ключ не предоставлен' });
      }
      
      // Сохраняем ключ в БД
      const saved = await apiKeyService.saveApiKey(req.user.id, 'deepseek', apiKey);
      
      if (saved) {
        return res.json({ success: true, message: 'API ключ DeepSeek успешно сохранен' });
      } else {
        return res.status(500).json({ success: false, error: 'Не удалось сохранить API ключ DeepSeek' });
      }
      
    } catch (error: any) {
      console.error('Ошибка при сохранении API ключа DeepSeek:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Непредвиденная ошибка при сохранении API ключа DeepSeek'
      });
    }
  });
  
  // Тестовый эндпоинт для генерации текста через DeepSeek API
  app.post('/api/test-deepseek-generate', async (req: Request, res: Response) => {
    try {
      console.log('Тестирование генерации текста с DeepSeek API');
      
      // Проверяем, что пользователь авторизован
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const { prompt } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Не указан текст запроса (prompt)' });
      }
      
      // Инициализируем DeepSeek сервис с API ключом пользователя
      const initialized = await deepseekService.initialize(req.user.id);
      
      if (!initialized) {
        return res.status(400).json({ 
          success: false, 
          error: 'Не удалось инициализировать DeepSeek API. Проверьте настройки API ключа.' 
        });
      }
      
      // Формируем сообщения для запроса
      const messages: DeepSeekMessage[] = [
        { role: 'system', content: 'Ты полезный ассистент, который отвечает на вопросы пользователя кратко и информативно.' },
        { role: 'user', content: prompt }
      ];
      
      console.log(`Отправка запроса в DeepSeek: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
      
      // Отправляем запрос к API
      const generatedText = await deepseekService.generateText(
        messages,
        { 
          model: 'deepseek-chat',  // Используем современную модель DeepSeek Chat
          temperature: 0.7,
          max_tokens: 1000  // Увеличиваем лимит токенов для более полных ответов
        }
      );
      
      console.log(`Успешно получен ответ от DeepSeek API длиной ${generatedText.length} символов`);
      
      // Возвращаем результат
      return res.json({
        success: true,
        data: generatedText,
        message: 'Текст успешно сгенерирован'
      });
      
    } catch (error: any) {
      console.error('Ошибка при генерации текста с DeepSeek API:', error);
      
      // Формируем подробное сообщение об ошибке для фронтенда
      let errorMessage = error.message || 'Непредвиденная ошибка при генерации текста';
      
      if (error.response?.data) {
        try {
          const errorDetails = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data).substring(0, 300);
          errorMessage += ` (Статус: ${error.response.status}) Ответ API: ${errorDetails}`;
        } catch (e) {
          errorMessage += ` (Статус: ${error.response.status}) [Не удалось извлечь детали ошибки]`;
        }
      }
      
      res.status(500).json({ 
        success: false, 
        error: errorMessage
      });
    }
  });
  
  // Тестовый эндпоинт для генерации промта для изображения
  app.post('/api/test-deepseek-image-prompt', async (req: Request, res: Response) => {
    try {
      console.log('Тестирование генерации промта для изображения с DeepSeek API');
      
      // Проверяем, что пользователь авторизован
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
      }
      
      const { content, keywords = [] } = req.body;
      
      if (!content) {
        return res.status(400).json({ success: false, error: 'Не указан текст для генерации промта' });
      }
      
      // Инициализируем DeepSeek сервис с API ключом пользователя
      const initialized = await deepseekService.initialize(req.user.id);
      
      if (!initialized) {
        return res.status(400).json({ 
          success: false, 
          error: 'Не удалось инициализировать DeepSeek API. Проверьте настройки API ключа.' 
        });
      }
      
      console.log(`Отправка запроса для генерации промта изображения: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
      
      // Генерируем промт для изображения
      const imagePrompt = await deepseekService.generateImagePrompt(
        content,
        keywords
      );
      
      console.log(`Успешно получен промт для изображения: "${imagePrompt.substring(0, 100)}${imagePrompt.length > 100 ? '...' : ''}"`);
      
      // Возвращаем результат
      return res.json({
        success: true,
        data: imagePrompt,
        message: 'Промт для изображения успешно сгенерирован'
      });
      
    } catch (error: any) {
      console.error('Ошибка при генерации промта для изображения с DeepSeek API:', error);
      
      // Формируем подробное сообщение об ошибке для фронтенда
      let errorMessage = error.message || 'Непредвиденная ошибка при генерации промта для изображения';
      
      if (error.response?.data) {
        try {
          const errorDetails = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data).substring(0, 300);
          errorMessage += ` (Статус: ${error.response.status}) Ответ API: ${errorDetails}`;
        } catch (e) {
          errorMessage += ` (Статус: ${error.response.status}) [Не удалось извлечь детали ошибки]`;
        }
      }
      
      res.status(500).json({ 
        success: false, 
        error: errorMessage
      });
    }
  });
}