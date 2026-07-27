import express, { Express } from 'express';
import { falAiUniversalService, FalAiGenerateOptions } from './services/fal-ai-universal';
import { falAiJuggernautService } from './services/fal-ai-juggernaut';
import { directusApi } from './lib/directus';
import { getUsage, incrementUsage, canGenerate } from './services/image-gen-tracker';
import { getEffectivePlan } from './services/plan-limits';

const BASIC_PLAN_LIMIT = 30;
const TRIAL_PLAN_LIMIT = 10;

async function getUserPlanInfo(req: express.Request): Promise<{ userId: string | null; plan: string }> {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    if (!token || !token.includes('.')) return { userId: null, plan: 'free' };

    const parts = token.split('.');
    if (parts.length !== 3) return { userId: null, plan: 'free' };

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const userId = payload.id;
    if (!userId) return { userId: null, plan: 'free' };

    const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN;
    const resp = await directusApi.get(`/users/${userId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { fields: 'plan,expire_date' }
    });
    const userData = resp.data?.data;
    return { userId, plan: getEffectivePlan(userData?.plan, userData?.expire_date) };
  } catch {
    return { userId: null, plan: 'free' };
  }
}

// Функция для регистрации маршрутов в Express приложении
export function registerFalAiImageRoutes(app: Express) {
  // Получить список доступных моделей
  app.get('/api/fal-ai-models', async (req, res) => {
    try {
      // Статический список поддерживаемых моделей FAL.AI
      // Использует официальные имена моделей, проверенные в фактической работе
      const models = [
        { 
          id: 'schnell', 
          name: 'Schnell', 
          description: 'Быстрая базовая модель FAL.AI (рекомендуется)' 
        },
        { 
          id: 'fal-ai/fast-sdxl', 
          name: 'Fast SDXL', 
          description: 'Быстрая генерация с высоким качеством' 
        },
        { 
          id: 'fal-ai/lcm-sdxl', 
          name: 'LCM-SDXL', 
          description: 'Сверхбыстрая генерация (ниже качество)' 
        },
        { 
          id: 'rundiffusion-fal/juggernaut-flux-lora', 
          name: 'Juggernaut Flux Lora', 
          description: 'Высочайшее качество изображений' 
        },
        { 
          id: 'rundiffusion-fal/juggernaut-flux/lightning', 
          name: 'Juggernaut Flux Lightning', 
          description: 'Баланс скорости и качества' 
        },
        { 
          id: 'fal-ai/flux-lora', 
          name: 'Flux Lora', 
          description: 'Альтернативная Flux модель' 
        },
        { 
          id: 'fal-ai/juggernaut-xl-v9', 
          name: 'Juggernaut XL', 
          description: 'Детализированные реалистичные изображения' 
        },
        { 
          id: 'fal-ai/illusion-xl-v1', 
          name: 'Illusion XL', 
          description: 'Художественные и креативные изображения' 
        },
        { 
          id: 'fal-ai/nano-banana-pro', 
          name: 'NanoBanana Pro ⚡', 
          description: 'Gemini 3 Pro Image - высочайшее качество (через FAL)' 
        },
        { 
          id: 'fal-ai/nano-banana-pro/edit', 
          name: 'NanoBanana Pro/Edit ✏️', 
          description: 'Редактирование изображений с Gemini 3 Pro ($0.15)' 
        }
      ];

      res.json({
        success: true,
        models
      });
    } catch (error) {
      console.error('[api] Ошибка при получении списка моделей:', error);
      res.status(500).json({
        success: false,
        error: 'Не удалось получить список моделей'
      });
    }
  });

  // Получить текущее использование генераций
  app.get('/api/user/image-gen-usage', async (req, res) => {
    const { userId, plan } = await getUserPlanInfo(req);
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    const usage = await getUsage(userId);
    const limit = plan === 'basic' ? BASIC_PLAN_LIMIT : plan === 'trial' ? TRIAL_PLAN_LIMIT : null;
    res.json({
      count: usage.count,
      limit,
      remaining: limit !== null ? Math.max(0, limit - usage.count) : null,
      month: usage.month,
      plan,
    });
  });

  // Генерация изображения с использованием универсального сервиса по API
  app.post('/api/fal-ai-images', async (req, res) => {
    try {
      // Валидация запроса
      const { prompt, negativePrompt, width, height, numImages, model, stylePreset, imageSize } = req.body;
      
      console.log(`[api] Приняты параметры: ${
        imageSize ? `формат: ${imageSize}` : `размер: ${width}x${height}`
      }, стиль: ${stylePreset || 'не указан'}`);
      
      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Не указан промт для генерации'
        });
      }

      // Проверка плана и месячного лимита
      const { userId: planUserId, plan } = await getUserPlanInfo(req);
      if (plan === 'free') {
        return res.status(403).json({ success: false, error: 'Генерация изображений недоступна на вашем тарифе.' });
      }
      if ((plan === 'basic' || plan === 'trial') && planUserId) {
        const planLimit = plan === 'trial' ? TRIAL_PLAN_LIMIT : BASIC_PLAN_LIMIT;
        if (!(await canGenerate(planUserId, planLimit))) {
          const usage = await getUsage(planUserId);
          return res.status(429).json({
            success: false,
            error: `Лимит генераций исчерпан (${usage.count}/${planLimit} в месяц). Оформите подписку для продолжения.`,
            limitExceeded: true,
          });
        }
      }

      // Получаем токен авторизации из заголовка или используем FAL_AI_API_KEY из переменных окружения
      const authHeader = req.headers.authorization || '';
      let token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

      if (!token) {
        // Используем сохраненный API ключ, если заголовок не предоставлен
        token = process.env.FAL_AI_API_KEY || '';
        
        if (!token) {
          return res.status(401).json({
            success: false,
            error: 'Отсутствует токен авторизации'
          });
        }
        console.log('[api] Используем FAL_AI_API_KEY из переменных окружения');
      }

      // Создаем параметры для генерации
      const generateOptions: any = {
        prompt,
        negativePrompt,
        width: parseInt(width) || 1024,
        height: parseInt(height) || 1024,
        numImages: parseInt(numImages) || 1,
        model: model || 'schnell', // Используем Schnell по умолчанию
        token,
        stylePreset // Добавляем передачу параметра стиля
      };

      // Выбираем правильный сервис в зависимости от модели
      console.log(`[api] Запрос на генерацию изображения с моделью ${generateOptions.model}`);
      
      let imageUrls: string[] = [];
      
      // Определяем, какой сервис использовать для генерации изображений
      // Разделяем модели на категории для корректной обработки
      const isJuggernautModel = 
        model === 'rundiffusion-fal/juggernaut-flux-lora' || 
        model === 'rundiffusion-fal/juggernaut-flux/lightning' ||
        model === 'fal-ai/flux-lora';
      
      const isStandardModel = 
        model === 'stable-diffusion-xl' || 
        model === 'fal-ai/fast-sdxl' || 
        model === 'fal-ai/lcm-sdxl' ||
        model === 'fal-ai/juggernaut-xl-v9' ||
        model === 'fal-ai/illusion-xl-v1' ||
        model === 'fooocus';
        
      const isSchnellModel = model === 'schnell';
      
      const isNanoBananaProModel = 
        model === 'fal-ai/nano-banana-pro' || 
        model === 'nano-banana-pro';
      
      const isNanoBananaProEditModel = 
        model === 'fal-ai/nano-banana-pro/edit' || 
        model === 'nano-banana-pro/edit';
      
      // Перенаправляем запрос на соответствующий сервис
      if (isJuggernautModel) {
        // Инициализируем сервис Juggernaut с API ключом
        falAiJuggernautService.initialize(token);
        
        // Создаем параметры специально для Juggernaut моделей
        const juggernautOptions: any = {
          prompt,
          negativePrompt,
          numImages: parseInt(numImages) || 1,
          model: model,
          stylePreset, // Добавляем параметр стиля для Juggernaut моделей
        };
        
        // Добавляем либо строковый формат, либо числовые значения ширины/высоты
        if (imageSize) {
          console.log(`[api] Отправляем запрос к Juggernaut с форматом ${imageSize} и стилем ${stylePreset || 'не указан'}`);
          juggernautOptions.imageSize = imageSize;
        } else {
          console.log(`[api] Отправляем запрос к Juggernaut с размером ${parseInt(width) || 1024}x${parseInt(height) || 1024} и стилем ${stylePreset || 'не указан'}`);
          juggernautOptions.width = parseInt(width) || 1024;
          juggernautOptions.height = parseInt(height) || 1024;
        }
        
        console.log(`[api] Используем специализированный сервис для модели Juggernaut: ${model}`);
        imageUrls = await falAiJuggernautService.generateImages(juggernautOptions);
      } else if (isSchnellModel) {
        console.log(`[api] Используем специальный endpoint для модели Schnell`);
        
        // Создаем объект параметров для Schnell
        const schnellOptions: any = {
          prompt,
          negativePrompt,
          numImages: parseInt(numImages) || 1,
          token,
          stylePreset // Передаём параметр стиля для модели Schnell
        };
        
        // Добавляем либо строковый формат, либо числовые значения ширины/высоты
        if (imageSize) {
          console.log(`[api] Отправляем запрос к Schnell с форматом ${imageSize} и стилем ${stylePreset || 'не указан'}`);
          schnellOptions.imageSize = imageSize;
        } else {
          console.log(`[api] Отправляем запрос к Schnell с размером ${parseInt(width) || 1024}x${parseInt(height) || 1024} и стилем ${stylePreset || 'не указан'}`);
          schnellOptions.width = parseInt(width) || 1024;
          schnellOptions.height = parseInt(height) || 1024;
        }
        
        // Для Schnell используем прямой endpoint через falAiUniversalService, но указываем специфический путь
        imageUrls = await falAiUniversalService.generateWithSchnell(schnellOptions);
      } else if (isNanoBananaProModel) {
        console.log(`[api] 🍌⚡ Используем NanoBanana Pro (Gemini 3 Pro Image) через FAL AI`);
        
        // Создаем объект параметров для NanoBanana Pro
        const nanoBananaOptions: any = {
          prompt,
          negativePrompt,
          numImages: parseInt(numImages) || 1,
          model: 'fal-ai/nano-banana-pro',
          token,
          stylePreset
        };
        
        // Добавляем либо строковый формат, либо числовые значения ширины/высоты
        if (imageSize) {
          console.log(`[api] 🍌⚡ Отправляем запрос к NanoBanana Pro с форматом ${imageSize}`);
          nanoBananaOptions.imageSize = imageSize;
        } else {
          console.log(`[api] 🍌⚡ Отправляем запрос к NanoBanana Pro с размером ${parseInt(width) || 1024}x${parseInt(height) || 1024}`);
          nanoBananaOptions.width = parseInt(width) || 1024;
          nanoBananaOptions.height = parseInt(height) || 1024;
        }
        
        // Используем универсальный сервис для NanoBanana Pro
        imageUrls = await falAiUniversalService.generateImages(nanoBananaOptions);
      } else if (isNanoBananaProEditModel) {
        console.log(`[api] 🍌✏️ Используем NanoBanana Pro/Edit (редактирование изображений) через FAL AI`);
        
        // Получаем imageUrls из тела запроса
        const { imageUrls: sourceImageUrls } = req.body;
        
        if (!sourceImageUrls || !Array.isArray(sourceImageUrls) || sourceImageUrls.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Для редактирования необходимо загрузить исходное изображение'
          });
        }
        
        // Создаем объект параметров для NanoBanana Pro/Edit
        const nanoBananaEditOptions: any = {
          prompt,
          negativePrompt,
          numImages: parseInt(numImages) || 1,
          model: 'fal-ai/nano-banana-pro/edit',
          token,
          imageUrls: sourceImageUrls
        };
        
        console.log(`[api] 🍌✏️ Отправляем запрос с ${sourceImageUrls.length} исходным(и) изображением(ями)`);
        
        // Используем универсальный сервис для NanoBanana Pro/Edit
        imageUrls = await falAiUniversalService.generateImages(nanoBananaEditOptions);
      } else {
        // Для других стандартных моделей используем универсальный сервис
        console.log(`[api] Используем универсальный сервис для модели: ${model}`);
        imageUrls = await falAiUniversalService.generateImages(generateOptions);
      }

      // Проверяем результат и форматируем его для тестовых скриптов
      if (imageUrls && imageUrls.length > 0) {
        console.log(`[api] Успешно получено ${imageUrls.length} изображений`);
        
        imageUrls.forEach((url, index) => {
          console.log(`[api] Изображение ${index + 1}: ${url}`);
        });

        // Инкрементируем счётчик после успешной генерации
        let usageInfo: { count?: number; remaining?: number | null } = {};
        if (planUserId && (plan === 'basic' || plan === 'trial')) {
          const planLimit = plan === 'trial' ? TRIAL_PLAN_LIMIT : BASIC_PLAN_LIMIT;
          const newCount = await incrementUsage(planUserId);
          usageInfo = { count: newCount, remaining: Math.max(0, planLimit - newCount) };
          console.log(`[image-gen] User ${planUserId.slice(0, 8)} ${plan} usage: ${newCount}/${planLimit}`);
        }
        
        res.json({
          success: true,
          images: imageUrls,
          ...usageInfo,
        });
      } else {
        console.warn(`[api] Сервис вернул пустой массив URL изображений`);
        res.json({
          success: false,
          images: [],
          error: "Не удалось получить URL изображений"
        });
      }
    } catch (error: any) {
      console.error('[api] Ошибка при генерации изображения:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Не удалось сгенерировать изображение'
      });
    }
  });
  console.log('[express] FAL.AI Universal Image Generation routes registered at /api');
}