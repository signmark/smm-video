/**
 * Оптимизированный сервер-эндпоинт для публикации карусели в Instagram
 * Использует более стабильную версию API и правильное форматирование параметров
 */

import express, { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

// Функция задержки для асинхронных операций
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Регистрация эндпоинта
export const register = (app: express.Express) => {
  
  // Эндпоинт для публикации карусели в Instagram
  app.post('/api/instagram-carousel', async (req: Request, res: Response) => {
    try {
      const { contentId, token } = req.body;
      
      if (!contentId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Отсутствует ID контента' 
        });
      }
      
      log(`Instagram Carousel API: Получен запрос на публикацию карусели для контента ${contentId}`);
      
      // 1. Получение данных контента
      let content;
      try {
        const contentResponse = await axios.get(
          `${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );
        content = contentResponse.data.data;
        log(`Контент получен: ${JSON.stringify(content.title || 'Без заголовка')}`);
      } catch (error) {
        log(`Ошибка при получении контента: ${error.message}`);
        if (error.response) {
          log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка при получении контента' 
        });
      }
      
      // 2. Проверка наличия основного изображения и дополнительных изображений
      const mainImageUrl = content.imageUrl;
      let additionalImages = content.additionalImages || [];
      
      // Преобразуем строку в массив, если это необходимо
      if (typeof additionalImages === 'string') {
        try {
          additionalImages = JSON.parse(additionalImages);
        } catch (e) {
          additionalImages = [];
        }
      }
      
      // Убедимся, что это массив
      if (!Array.isArray(additionalImages)) {
        additionalImages = [];
      }
      
      // Собираем все изображения в один массив, начиная с основного
      const allImages = mainImageUrl ? [mainImageUrl, ...additionalImages] : [...additionalImages];
      
      if (allImages.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Нет изображений для публикации в карусели' 
        });
      }
      
      // Instagram требует минимум 2 изображения для карусели
      if (allImages.length < 2) {
        return res.status(400).json({ 
          success: false, 
          error: 'Для карусели необходимо как минимум 2 изображения' 
        });
      }
      
      log(`Подготовлено ${allImages.length} изображений для карусели`);
      
      // 3. Получение настроек Instagram
      const socialPlatforms = content.socialPlatforms || [];
      const instagramSettings = socialPlatforms.find((p: any) => p.platform === 'instagram');
      
      if (!instagramSettings) {
        return res.status(400).json({ 
          success: false, 
          error: 'Не найдены настройки для Instagram' 
        });
      }
      
      const INSTAGRAM_TOKEN = instagramSettings.token || process.env.INSTAGRAM_TOKEN;
      const INSTAGRAM_BUSINESS_ACCOUNT_ID = instagramSettings.businessAccountId || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
      
      if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
        return res.status(400).json({ 
          success: false, 
          error: 'Отсутствуют учетные данные Instagram' 
        });
      }
      
      log(`Instagram Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
      
      // 4. Создание контейнеров для отдельных изображений
      const containerIds = [];
      
      for (let i = 0; i < allImages.length; i++) {
        const imageUrl = allImages[i];
        log(`Обработка изображения ${i+1}/${allImages.length}: ${imageUrl}`);
        
        try {
          const containerResponse = await axios({
            method: 'post',
            url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
            data: {
              access_token: INSTAGRAM_TOKEN,
              image_url: imageUrl,
              is_carousel_item: true
            }
          });
          
          if (containerResponse.data && containerResponse.data.id) {
            containerIds.push(containerResponse.data.id);
            log(`Контейнер создан успешно, ID: ${containerResponse.data.id}`);
          } else {
            log(`Ошибка: Ответ без ID контейнера`);
          }
        } catch (error) {
          log(`Ошибка при создании контейнера: ${error.message}`);
          if (error.response) {
            log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
          }
        }
        
        // Задержка между запросами для избежания лимитов API
        await delay(1000);
      }
      
      log(`Создано ${containerIds.length} контейнеров из ${allImages.length} изображений`);
      
      // Проверяем, что созданы контейнеры
      if (containerIds.length === 0) {
        return res.status(500).json({ 
          success: false, 
          error: 'Не удалось создать контейнеры для изображений' 
        });
      }
      
      // 5. Создание контейнера карусели
      let carouselContainerId;
      const caption = content.content;
      
      try {
        log(`Создание контейнера карусели с ${containerIds.length} изображениями`);
        
        const carouselResponse = await axios({
          method: 'post',
          url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
          data: {
            access_token: INSTAGRAM_TOKEN,
            media_type: 'CAROUSEL',
            children: containerIds.join(','),
            caption: caption
          }
        });
        
        if (carouselResponse.data && carouselResponse.data.id) {
          carouselContainerId = carouselResponse.data.id;
          log(`Контейнер карусели создан успешно, ID: ${carouselContainerId}`);
        } else {
          log(`Ошибка: Ответ без ID контейнера карусели`);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при создании контейнера карусели' 
          });
        }
      } catch (error) {
        log(`Ошибка при создании контейнера карусели: ${error.message}`);
        if (error.response) {
          log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        return res.status(500).json({ 
          success: false, 
          error: `Ошибка при создании контейнера карусели: ${error.message}` 
        });
      }
      
      // Задержка перед публикацией
      await delay(2000);
      
      // 6. Публикация карусели
      try {
        log(`Публикация карусели, контейнер ID: ${carouselContainerId}`);
        
        const publishResponse = await axios({
          method: 'post',
          url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
          data: {
            access_token: INSTAGRAM_TOKEN,
            creation_id: carouselContainerId
          }
        });
        
        if (publishResponse.data && publishResponse.data.id) {
          const postId = publishResponse.data.id;
          log(`Карусель опубликована успешно, ID публикации: ${postId}`);
          
          // 7. Получение постоянной ссылки
          try {
            const permalinkResponse = await axios.get(
              `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
            );
            
            if (permalinkResponse.data && permalinkResponse.data.permalink) {
              const permalink = permalinkResponse.data.permalink;
              log(`Постоянная ссылка на публикацию: ${permalink}`);
              
              return res.status(200).json({
                success: true,
                postId,
                permalink,
                message: 'Карусель успешно опубликована в Instagram'
              });
            } else {
              log(`Не удалось получить постоянную ссылку на публикацию`);
              
              return res.status(200).json({
                success: true,
                postId,
                message: 'Карусель опубликована, но не удалось получить постоянную ссылку'
              });
            }
          } catch (error) {
            log(`Ошибка при получении ссылки: ${error.message}`);
            
            return res.status(200).json({
              success: true,
              postId,
              message: 'Карусель опубликована, но не удалось получить постоянную ссылку'
            });
          }
        } else {
          log(`Ошибка: Ответ без ID публикации`);
          return res.status(500).json({ 
            success: false, 
            error: 'Ошибка при публикации карусели: ответ без ID' 
          });
        }
      } catch (error) {
        log(`Ошибка при публикации карусели: ${error.message}`);
        if (error.response) {
          log(`Детали ошибки: ${JSON.stringify(error.response.data)}`);
        }
        return res.status(500).json({ 
          success: false, 
          error: `Ошибка при публикации карусели: ${error.message}` 
        });
      }
      
    } catch (e) {
      log(`Общая ошибка в Instagram Carousel API: ${e.message}`);
      return res.status(500).json({ 
        success: false, 
        error: `Внутренняя ошибка сервера: ${e.message}` 
      });
    }
  });
  
  log('Регистрация Instagram Carousel API завершена');
};

/**
 * Публикует карусель в Instagram через прямую интеграцию с API
 * @param contentId ID контента для публикации
 * @param imageUrls Массив URL изображений для карусели
 * @param caption Текст публикации
 * @param token Токен Instagram API
 * @param businessAccountId ID бизнес-аккаунта Instagram
 * @returns Результат публикации карусели
 */
export async function publishCarousel(
  contentId: string, 
  imageUrls: string[], 
  caption: string, 
  token: string, 
  businessAccountId: string
): Promise<any> {
  try {
    log(`[Instagram Carousel] Публикация карусели для контента ${contentId}`);
    log(`[Instagram Carousel] Количество изображений: ${imageUrls.length}`);
    
    // 1. Создание контейнеров для изображений
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
        
        // Если некоторые контейнеры созданы, прекращаем создание новых
        break;
      }
    }
    
    // Проверяем количество контейнеров
    if (containerIds.length < 2) {
      throw new Error('Недостаточно контейнеров для создания карусели (минимум 2)');
    }
    
    log(`[Instagram Carousel] Создано ${containerIds.length} контейнеров`);
    
    // Большая задержка перед созданием контейнера карусели (15 секунд)
    log(`[Instagram Carousel] Задержка 15 секунд перед созданием контейнера карусели...`);
    await delay(15000);
    
    // 2. Создание контейнера карусели
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
      } else {
        throw new Error('Ответ без ID контейнера карусели');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при создании контейнера карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
    
    // Большая задержка перед публикацией (20 секунд)
    log(`[Instagram Carousel] Задержка 20 секунд перед публикацией карусели...`);
    await delay(20000);
    
    // 3. Публикация карусели
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
        
        // Получаем permalink публикации
        let permalink = null;
        try {
          const permalinkResponse = await axios.get(
            `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${token}`
          );
          
          if (permalinkResponse.data && permalinkResponse.data.permalink) {
            permalink = permalinkResponse.data.permalink;
            log(`[Instagram Carousel] Получен permalink: ${permalink}`);
          }
        } catch (error: any) {
          log(`[Instagram Carousel] Ошибка при получении permalink: ${error.message}`);
          // Продолжаем выполнение, даже если не удалось получить permalink
        }
        
        return {
          success: true,
          message: 'Карусель успешно опубликована',
          postId,
          permalink
        };
      } else {
        throw new Error('Ответ без ID публикации');
      }
    } catch (error: any) {
      log(`[Instagram Carousel] Ошибка при публикации карусели: ${error.message}`);
      if (error.response) {
        log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
      }
      
      // Если это ошибка 2207032, сообщаем о временном ограничении API
      if (error.response && 
          error.response.data && 
          error.response.data.error && 
          error.response.data.error.error_subcode === 2207032) {
        throw new Error('Временное ограничение API Instagram (код 2207032). Пожалуйста, повторите попытку через 10-15 минут.');
      }
      
      throw error;
    }
  } catch (error: any) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    throw error;
  }
}

export default { register };