# Руководство по интеграции новых языковых моделей

## Пошаговая инструкция для добавления новой языковой модели (Gemini, Perplexity и др.)

### 1. Создать сервис для новой модели

Создайте файл `server/services/gemini.ts` с базовой структурой:

```typescript
/**
 * Сервис для работы с Google Gemini API
 */
export class GeminiService {
  private apiKey: string;
  
  /**
   * Конструктор сервиса Gemini
   * @param apiKey API ключ Gemini
   */
  constructor(params: { apiKey: string }) {
    this.apiKey = params.apiKey;
  }
  
  /**
   * Проверяет валидность API ключа
   * @returns true если ключ валидный, false если нет
   */
  async testApiKey(): Promise<boolean> {
    try {
      // Логика проверки API ключа
      return true;
    } catch (error) {
      console.error('[gemini-service] Error testing API key:', error);
      return false;
    }
  }
  
  /**
   * Улучшает текст с помощью модели
   * @param params Параметры улучшения текста
   * @returns Улучшенный текст
   */
  async improveText(params: {
    text: string;
    prompt: string;
    model?: string;
  }): Promise<string> {
    const { text, prompt, model = 'gemini-pro' } = params;
    
    try {
      // Логика запроса к API
      // Здесь должен быть код, работающий с API Gemini
      
      return 'Улучшенный текст'; // Замените на реальный результат от API
    } catch (error) {
      console.error('[gemini-service] Error improving text:', error);
      throw new Error('Не удалось улучшить текст с помощью Gemini');
    }
  }
}
```

### 2. Создать файл с API-маршрутами

Создайте файл `server/routes-gemini.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import { GeminiService } from './services/gemini';
import { getUserApiKey } from './services/api-key-service';
import { log } from './utils/logger';

export function registerGeminiRoutes(app: any) {
  const router = Router();
  
  /**
   * Получает экземпляр сервиса Gemini для пользователя
   * @param req Запрос Express
   * @returns Экземпляр GeminiService или null, если ключ не настроен
   */
  async function getGeminiService(req: Request): Promise<GeminiService | null> {
    const apiKey = await getGeminiApiKey(req);
    
    if (!apiKey) {
      return null;
    }
    
    return new GeminiService({ apiKey });
  }
  
  /**
   * Получает API ключ Gemini для пользователя
   * @param req Запрос Express
   * @returns API ключ или null, если не настроен
   */
  async function getGeminiApiKey(req: Request): Promise<string | null> {
    try {
      const userId = req.userId;
      if (!userId) {
        log('No user ID found in request');
        return null;
      }
      
      return await getUserApiKey(userId, 'gemini');
    } catch (error) {
      log('Error getting Gemini API key:', (error as Error).message);
      return null;
    }
  }

  /**
   * Маршрут для улучшения текста с помощью Gemini
   */
  router.post('/api/gemini/improve-text', async (req: Request, res: Response) => {
    try {
      const { text, prompt, model } = req.body;
      const userId = req.userId;
      
      log(`Received improve-text request from user ${userId}`);
      
      if (!text || !prompt) {
        log('Missing text or prompt in improve-text request');
        return res.status(400).json({
          success: false,
          error: 'Текст и инструкции обязательны'
        });
      }
      
      // Получаем сервис Gemini для пользователя
      const geminiService = await getGeminiService(req);
      
      if (!geminiService) {
        log(`Gemini API key not configured for user ${userId}`);
        return res.status(400).json({
          success: false,
          error: 'API ключ Gemini не настроен',
          needApiKey: true
        });
      }
      
      // Используем сервис для улучшения текста
      const improvedText = await geminiService.improveText({
        text,
        prompt,
        model
      });
      
      return res.json({
        success: true,
        text: improvedText
      });
    } catch (error) {
      log('Error improving text with Gemini:', (error as Error).message);
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при улучшении текста: ${(error as Error).message}`
      });
    }
  });
  
  /**
   * Маршрут для сохранения API ключа Gemini
   */
  router.post('/api/gemini/save-api-key', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      const userId = req.userId;
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API ключ обязателен'
        });
      }
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Требуется авторизация'
        });
      }
      
      // Проверяем валидность ключа
      const geminiService = new GeminiService({ apiKey });
      const isValid = await geminiService.testApiKey();
      
      if (!isValid) {
        return res.status(400).json({
          success: false,
          error: 'Недействительный API ключ Gemini'
        });
      }
      
      // Сохраняем ключ в базу данных
      // (Используем сервис для сохранения ключей)
      const apiKeyService = await import('./services/api-key-service');
      await apiKeyService.saveUserApiKey(userId, 'gemini', apiKey);
      
      return res.json({
        success: true
      });
    } catch (error) {
      log('Error saving Gemini API key:', (error as Error).message);
      
      return res.status(500).json({
        success: false,
        error: 'Ошибка при сохранении API ключа'
      });
    }
  });
  
  // Регистрируем все маршруты
  app.use(router);
}
```

### 3. Зарегистрировать маршруты в файле `server/index.ts`

```typescript
// Импортируем функцию регистрации маршрутов
import { registerGeminiRoutes } from './routes-gemini';

// В блоке инициализации сервера добавьте:
// Регистрируем маршруты для Gemini
console.log("Registering Gemini routes...");
log("Registering Gemini routes...");
registerGeminiRoutes(app);
console.log("Gemini routes registered");
log("Gemini routes registered successfully");
```

### 4. Убедитесь, что клиентский код готов к работе с новой моделью

В компоненте `TextEnhancementDialog.tsx` уже должен быть соответствующий case для маршрута Gemini:

```typescript
const getApiEndpoint = () => {
  switch (selectedService) {
    case 'claude':
      return '/claude/improve-text';
    case 'deepseek':
      return '/deepseek/improve-text';
    case 'qwen': 
      return '/qwen/improve-text';
    case 'gemini':
      return '/gemini/improve-text';
    default:
      return '/claude/improve-text';
  }
};
```

### 5. Реализуйте реальную интеграцию с API Gemini в сервисе

После базовой структуры добавьте реальный код для работы с API Gemini (используя официальные SDK или прямые HTTP запросы).

### Важно!

1. Все API маршруты должны начинаться с `/api`
2. В клиентском коде `baseURL` уже настроен как `/api`, поэтому в методе `getApiEndpoint()` не нужно включать `/api` в возвращаемый путь
3. Стандартная структура ответа:
   ```json
   {
     "success": true,
     "text": "Улучшенный текст"
   }
   ```
4. Структура ответа с ошибкой:
   ```json
   {
     "success": false,
     "error": "Текст ошибки",
     "needApiKey": true  // Опционально, если нужен API ключ
   }
   ```