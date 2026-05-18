/**
 * Прямой интерфейс для работы с Instagram Carousel API
 * Этот файл содержит маршруты для прямого взаимодействия с Instagram API
 * для создания и публикации карусельных постов.
 */

import express from 'express';
import axios from 'axios';
import { log } from '../utils/logger';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Задержка для асинхронных операций
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Временное хранилище для состояния карусели
 * Используется для отслеживания процесса публикации карусели
 */
interface CarouselState {
  contentId: string;
  attemptCount: number;
  status: 'pending' | 'containers_created' | 'carousel_created' | 'published' | 'failed';
  containerIds: string[];
  carouselContainerId: string | null;
  error: string | null;
  publishedId: string | null;
  permalink: string | null;
  lastAttemptAt: string;
  createdAt: string;
}

// In-memory хранилище состояний карусели (для прототипа)
// В реальном приложении это должно быть в БД
const carouselStateStore: Record<string, CarouselState> = {};

/**
 * @api {post} /api/instagram-carousel/create Создание контейнеров изображений для карусели
 * @apiDescription Создает контейнеры для отдельных изображений карусели в Instagram
 * @apiVersion 1.0.0
 * @apiName CreateCarouselImageContainers
 * @apiGroup InstagramCarousel
 * 
 * @apiParam {String} contentId ID контента для публикации
 * @apiParam {String[]} imageUrls Массив URL изображений для карусели
 * @apiParam {String} token Токен Instagram API
 * @apiParam {String} businessAccountId ID бизнес-аккаунта Instagram
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {String[]} containerIds ID созданных контейнеров
 */
router.post('/instagram-carousel/create', authMiddleware, async (req, res) => {
  try {
    const { contentId, imageUrls, token, businessAccountId } = req.body;
    
    if (!contentId || !Array.isArray(imageUrls) || imageUrls.length < 2 || !token || !businessAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId, не менее 2-х изображений, token и businessAccountId'
      });
    }
    
    log(`[Instagram Carousel] Создание контейнеров для карусели контента ${contentId}`);
    log(`[Instagram Carousel] Количество изображений: ${imageUrls.length}`);
    
    // Создаем или обновляем состояние карусели
    carouselStateStore[contentId] = {
      contentId,
      attemptCount: 0,
      status: 'pending',
      containerIds: [],
      carouselContainerId: null,
      error: null,
      publishedId: null,
      permalink: null,
      lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    // Получаем текущее состояние
    const carouselState = carouselStateStore[contentId];
    
    // Последовательно создаем контейнеры для всех изображений
    const containerIds: string[] = [];
    
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      log(`[Instagram Carousel] Создание контейнера для изображения ${i + 1}/${imageUrls.length}`);
      
      try {
        // Создаем контейнер для изображения
        const response = await axios({
          method: 'post',
          url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
          data: {
            access_token: token,
            image_url: imageUrl,
            is_carousel_item: true
          }
        });
        
        if (response.data && response.data.id) {
          containerIds.push(response.data.id);
          log(`[Instagram Carousel] Контейнер ${i + 1} создан успешно, ID: ${response.data.id}`);
        } else {
          throw new Error('Ответ без ID контейнера');
        }
        
        // Задержка перед созданием следующего контейнера (5 секунд)
        if (i < imageUrls.length - 1) {
          await delay(5000);
        }
      } catch (error: any) {
        log(`[Instagram Carousel] Ошибка при создании контейнера ${i + 1}: ${error.message}`);
        if (error.response) {
          log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        
        // Возвращаем ошибку, только если не создано ни одного контейнера
        if (containerIds.length === 0) {
          carouselState.status = 'failed';
          carouselState.error = `Ошибка при создании контейнера: ${error.message}`;
          
          return res.status(500).json({
            success: false,
            error: `Ошибка при создании контейнеров: ${error.message}`
          });
        }
        
        // Если некоторые контейнеры были созданы, прекращаем создание и используем то, что есть
        break;
      }
    }
    
    // Проверяем, были ли созданы контейнеры
    if (containerIds.length < 2) {
      carouselState.status = 'failed';
      carouselState.error = 'Недостаточно контейнеров для создания карусели (минимум 2)';
      
      return res.status(500).json({
        success: false,
        error: 'Недостаточно контейнеров для создания карусели (минимум 2)'
      });
    }
    
    // Обновляем состояние карусели
    carouselState.containerIds = containerIds;
    carouselState.status = 'containers_created';
    carouselState.lastAttemptAt = new Date().toISOString();
    
    return res.status(200).json({
      success: true,
      containerIds,
      carouselState: carouselState
    });
  } catch (error: any) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {post} /api/instagram-carousel/container Создание контейнера карусели
 * @apiDescription Создает контейнер карусели на основе ранее созданных контейнеров изображений
 * @apiVersion 1.0.0
 * @apiName CreateCarouselContainer
 * @apiGroup InstagramCarousel
 * 
 * @apiParam {String} contentId ID контента
 * @apiParam {String[]} containerIds ID контейнеров изображений
 * @apiParam {String} token Токен Instagram API
 * @apiParam {String} businessAccountId ID бизнес-аккаунта Instagram
 * @apiParam {String} caption Текст публикации
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {String} carouselContainerId ID созданного контейнера карусели
 */
router.post('/instagram-carousel/container', authMiddleware, async (req, res) => {
  try {
    const { contentId, containerIds, token, businessAccountId, caption } = req.body;
    
    if (!contentId || !Array.isArray(containerIds) || containerIds.length < 2 || !token || !businessAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId, не менее 2-х ID контейнеров, token и businessAccountId'
      });
    }
    
    log(`[Instagram Carousel] Создание контейнера карусели для контента ${contentId}`);
    log(`[Instagram Carousel] Используемые контейнеры: ${containerIds.join(', ')}`);
    
    // Получаем состояние карусели
    let carouselState = carouselStateStore[contentId];
    
    // Если состояние не найдено, создаем новое
    if (!carouselState) {
      carouselState = {
        contentId,
        attemptCount: 0,
        status: 'containers_created', // Предполагаем, что контейнеры уже созданы
        containerIds: containerIds,
        carouselContainerId: null,
        error: null,
        publishedId: null,
        permalink: null,
        lastAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      carouselStateStore[contentId] = carouselState;
    }
    
    // Увеличиваем счетчик попыток
    carouselState.attemptCount++;
    
    try {
      // Создаем контейнер карусели
      const response = await axios({
        method: 'post',
        url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
        data: {
          access_token: token,
          media_type: 'CAROUSEL',
          children: containerIds.join(','),
          caption: caption || ''
        }
      });
      
      if (response.data && response.data.id) {
        const carouselContainerId = response.data.id;
        log(`[Instagram Carousel] Контейнер карусели создан успешно, ID: ${carouselContainerId}`);
        
        // Обновляем состояние
        carouselState.carouselContainerId = carouselContainerId;
        carouselState.status = 'carousel_created';
        carouselState.lastAttemptAt = new Date().toISOString();
        
        return res.status(200).json({
          success: true,
          carouselContainerId,
          carouselState: carouselState
        });
      } else {
        throw new Error('Ответ без ID контейнера карусели');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при создании контейнера карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      
      // Обновляем состояние
      carouselState.error = `Ошибка при создании контейнера карусели: ${error.message}`;
      
      // Если это не первая попытка и произошла ошибка, отмечаем как ошибку
      if (carouselState.attemptCount >= 3) {
        carouselState.status = 'failed';
      }
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при создании контейнера карусели: ${error.message}`,
        carouselState: carouselState
      });
    }
  } catch (error: any) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {post} /api/instagram-carousel/publish Публикация карусели
 * @apiDescription Публикует ранее созданный контейнер карусели в Instagram
 * @apiVersion 1.0.0
 * @apiName PublishCarousel
 * @apiGroup InstagramCarousel
 * 
 * @apiParam {String} contentId ID контента
 * @apiParam {String} carouselContainerId ID контейнера карусели
 * @apiParam {String} token Токен Instagram API
 * @apiParam {String} businessAccountId ID бизнес-аккаунта Instagram
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {String} postId ID опубликованного поста
 * @apiSuccess {String} permalink Постоянная ссылка на публикацию
 */
router.post('/instagram-carousel/publish', authMiddleware, async (req, res) => {
  try {
    const { contentId, carouselContainerId, token, businessAccountId } = req.body;
    
    if (!contentId || !carouselContainerId || !token || !businessAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId, carouselContainerId, token и businessAccountId'
      });
    }
    
    log(`[Instagram Carousel] Публикация карусели для контента ${contentId}`);
    log(`[Instagram Carousel] ID контейнера карусели: ${carouselContainerId}`);
    
    // Получаем состояние карусели
    let carouselState = carouselStateStore[contentId];
    
    // Если состояние не найдено, создаем новое
    if (!carouselState) {
      carouselState = {
        contentId,
        attemptCount: 0,
        status: 'carousel_created', // Предполагаем, что контейнер карусели уже создан
        containerIds: [],
        carouselContainerId: carouselContainerId,
        error: null,
        publishedId: null,
        permalink: null,
        lastAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      carouselStateStore[contentId] = carouselState;
    }
    
    // Увеличиваем счетчик попыток
    carouselState.attemptCount++;
    
    try {
      // Публикуем карусель
      const response = await axios({
        method: 'post',
        url: `https://graph.facebook.com/v16.0/${businessAccountId}/media_publish`,
        data: {
          access_token: token,
          creation_id: carouselContainerId
        }
      });
      
      if (response.data && response.data.id) {
        const postId = response.data.id;
        log(`[Instagram Carousel] Карусель опубликована успешно, ID публикации: ${postId}`);
        
        // Обновляем состояние
        carouselState.publishedId = postId;
        carouselState.status = 'published';
        carouselState.lastAttemptAt = new Date().toISOString();
        
        // Получаем permalink публикации
        let permalink = null;
        try {
          const permalinkResponse = await axios.get(
            `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${token}`
          );
          
          if (permalinkResponse.data && permalinkResponse.data.permalink) {
            permalink = permalinkResponse.data.permalink;
            carouselState.permalink = permalink;
            log(`[Instagram Carousel] Получен permalink: ${permalink}`);
          }
        } catch (error: any) {
          log(`[Instagram Carousel] Ошибка при получении permalink: ${error.message}`);
          // Продолжаем выполнение, даже если не удалось получить permalink
        }
        
        return res.status(200).json({
          success: true,
          postId,
          permalink,
          carouselState: carouselState
        });
      } else {
        throw new Error('Ответ без ID публикации');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при публикации карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      
      // Обновляем состояние
      carouselState.error = `Ошибка при публикации карусели: ${error.message}`;
      
      // Если это не первая попытка и произошла ошибка, отмечаем как ошибку
      if (carouselState.attemptCount >= 3) {
        carouselState.status = 'failed';
      }
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при публикации карусели: ${error.message}`,
        carouselState: carouselState,
        retryAfter: 60 // Рекомендуемое время (в секундах) до следующей попытки
      });
    }
  } catch (error: any) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {get} /api/instagram-carousel/status/:contentId Получение статуса публикации карусели
 * @apiDescription Возвращает текущий статус публикации карусели для указанного контента
 * @apiVersion 1.0.0
 * @apiName GetCarouselStatus
 * @apiGroup InstagramCarousel
 * 
 * @apiParam {String} contentId ID контента
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} carouselState Текущее состояние процесса публикации карусели
 */
router.get('/instagram-carousel/status/:contentId', authMiddleware, (req, res) => {
  try {
    const { contentId } = req.params;
    
    // Получаем состояние карусели
    const carouselState = carouselStateStore[contentId];
    
    if (!carouselState) {
      return res.status(404).json({
        success: false,
        error: 'Состояние карусели не найдено'
      });
    }
    
    return res.status(200).json({
      success: true,
      carouselState
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

/**
 * @api {post} /api/instagram-carousel/complete Полная публикация карусели одним запросом
 * @apiDescription Выполняет все этапы публикации карусели в Instagram одним запросом
 * @apiVersion 1.0.0
 * @apiName CompleteCarouselPublication
 * @apiGroup InstagramCarousel
 * 
 * @apiParam {String} contentId ID контента
 * @apiParam {String[]} imageUrls Массив URL изображений для карусели
 * @apiParam {String} caption Текст публикации
 * @apiParam {String} token Токен Instagram API
 * @apiParam {String} businessAccountId ID бизнес-аккаунта Instagram
 * 
 * @apiSuccess {Boolean} success Статус операции
 * @apiSuccess {Object} carouselState Текущее состояние процесса публикации карусели
 */
router.post('/instagram-carousel/complete', authMiddleware, async (req, res) => {
  try {
    const { contentId, imageUrls, caption, token, businessAccountId } = req.body;
    
    if (!contentId || !Array.isArray(imageUrls) || imageUrls.length < 2 || !token || !businessAccountId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId, не менее 2-х изображений, token и businessAccountId'
      });
    }
    
    log(`[Instagram Carousel] Полная публикация карусели для контента ${contentId}`);
    log(`[Instagram Carousel] Количество изображений: ${imageUrls.length}`);
    
    // Создаем новое состояние карусели
    carouselStateStore[contentId] = {
      contentId,
      attemptCount: 1,
      status: 'pending',
      containerIds: [],
      carouselContainerId: null,
      error: null,
      publishedId: null,
      permalink: null,
      lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    
    // Получаем созданное состояние
    const carouselState = carouselStateStore[contentId];
    
    // 1. Создаем контейнеры для изображений
    const containerIds: string[] = [];
    
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      log(`[Instagram Carousel] Создание контейнера для изображения ${i + 1}/${imageUrls.length}`);
      
      try {
        // Создаем контейнер для изображения
        const response = await axios({
          method: 'post',
          url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
          data: {
            access_token: token,
            image_url: imageUrl,
            is_carousel_item: true
          }
        });
        
        if (response.data && response.data.id) {
          containerIds.push(response.data.id);
          log(`[Instagram Carousel] Контейнер ${i + 1} создан успешно, ID: ${response.data.id}`);
        } else {
          throw new Error('Ответ без ID контейнера');
        }
        
        // Задержка перед созданием следующего контейнера (8 секунд)
        if (i < imageUrls.length - 1) {
          await delay(8000);
        }
      } catch (error: any) {
        log(`[Instagram Carousel] Ошибка при создании контейнера ${i + 1}: ${error.message}`);
        if (error.response) {
          log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        
        // Если не создано ни одного контейнера, возвращаем ошибку
        if (containerIds.length === 0) {
          carouselState.status = 'failed';
          carouselState.error = `Ошибка при создании контейнера: ${error.message}`;
          
          return res.status(500).json({
            success: false,
            error: `Ошибка при создании контейнеров: ${error.message}`,
            carouselState: carouselState
          });
        }
        
        // Если некоторые контейнеры созданы, прекращаем создание новых
        break;
      }
    }
    
    // Обновляем состояние
    carouselState.containerIds = containerIds;
    
    // Проверяем количество контейнеров
    if (containerIds.length < 2) {
      carouselState.status = 'failed';
      carouselState.error = 'Недостаточно контейнеров для создания карусели (минимум 2)';
      
      return res.status(500).json({
        success: false,
        error: 'Недостаточно контейнеров для создания карусели (минимум 2)',
        carouselState: carouselState
      });
    }
    
    // Обновляем статус
    carouselState.status = 'containers_created';
    
    // Большая задержка перед созданием контейнера карусели (15 секунд)
    log(`[Instagram Carousel] Задержка 15 секунд перед созданием контейнера карусели...`);
    await delay(15000);
    
    // 2. Создаем контейнер карусели
    let carouselContainerId;
    try {
      log(`[Instagram Carousel] Создание контейнера карусели...`);
      
      const carouselResponse = await axios({
        method: 'post',
        url: `https://graph.facebook.com/v16.0/${businessAccountId}/media`,
        data: {
          access_token: token,
          media_type: 'CAROUSEL',
          children: containerIds.join(','),
          caption: caption || ''
        }
      });
      
      if (carouselResponse.data && carouselResponse.data.id) {
        carouselContainerId = carouselResponse.data.id;
        log(`[Instagram Carousel] Контейнер карусели создан успешно, ID: ${carouselContainerId}`);
        
        // Обновляем состояние
        carouselState.carouselContainerId = carouselContainerId;
        carouselState.status = 'carousel_created';
      } else {
        throw new Error('Ответ без ID контейнера карусели');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при создании контейнера карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      
      carouselState.error = `Ошибка при создании контейнера карусели: ${error.message}`;
      carouselState.status = 'failed';
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при создании контейнера карусели: ${error.message}`,
        carouselState: carouselState
      });
    }
    
    // Большая задержка перед публикацией (20 секунд)
    log(`[Instagram Carousel] Задержка 20 секунд перед публикацией карусели...`);
    await delay(20000);
    
    // 3. Публикуем карусель
    try {
      log(`[Instagram Carousel] Публикация карусели...`);
      
      const publishResponse = await axios({
        method: 'post',
        url: `https://graph.facebook.com/v16.0/${businessAccountId}/media_publish`,
        data: {
          access_token: token,
          creation_id: carouselContainerId
        }
      });
      
      if (publishResponse.data && publishResponse.data.id) {
        const postId = publishResponse.data.id;
        log(`[Instagram Carousel] Карусель опубликована успешно, ID публикации: ${postId}`);
        
        // Обновляем состояние
        carouselState.publishedId = postId;
        carouselState.status = 'published';
        
        // Получаем permalink публикации
        let permalink = null;
        try {
          const permalinkResponse = await axios.get(
            `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${token}`
          );
          
          if (permalinkResponse.data && permalinkResponse.data.permalink) {
            permalink = permalinkResponse.data.permalink;
            carouselState.permalink = permalink;
            log(`[Instagram Carousel] Получен permalink: ${permalink}`);
          }
        } catch (error: any) {
          log(`[Instagram Carousel] Ошибка при получении permalink: ${error.message}`);
          // Продолжаем выполнение, даже если не удалось получить permalink
        }
        
        return res.status(200).json({
          success: true,
          message: 'Карусель успешно опубликована',
          postId,
          permalink,
          carouselState: carouselState
        });
      } else {
        throw new Error('Ответ без ID публикации');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при публикации карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      
      carouselState.error = `Ошибка при публикации карусели: ${error.message}`;
      
      // Если это ошибка 2207032, сообщаем о временном ограничении API
      if (error.response && 
          error.response.data && 
          error.response.data.error && 
          error.response.data.error.error_subcode === 2207032) {
        
        carouselState.error += ' (Временное ограничение API Instagram, повторите попытку позже)';
        
        return res.status(429).json({
          success: false,
          error: `Временное ограничение API Instagram (код 2207032). Пожалуйста, повторите попытку через 10-15 минут.`,
          carouselState: carouselState,
          retryAfter: 900 // 15 минут
        });
      }
      
      // Обычная ошибка
      carouselState.status = 'failed';
      
      return res.status(500).json({
        success: false,
        error: `Ошибка при публикации карусели: ${error.message}`,
        carouselState: carouselState
      });
    }
  } catch (error: any) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

export default router;