# Реализация Instagram карусели в SMM Manager

Ниже представлен план реализации поддержки карусели Instagram в существующий проект SMM Manager.

## 1. Добавление обработчика для Instagram карусели

### 1.1. Создание веб-хука для обработки запросов публикации карусели

**Файл:** `server/api/instagram-carousel-webhook.ts`

```typescript
import express, { Request, Response } from 'express';
import axios from 'axios';
import { log } from '../utils/logger';

const router = express.Router();

// Задержка для асинхронных операций
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Обработчик для создания контейнера изображения
async function createImageContainer(imageUrl: string, token: string, businessAccountId: string) {
  try {
    log(`[Instagram Carousel] Создание контейнера для изображения: ${imageUrl}`);
    
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
      const containerId = response.data.id;
      log(`[Instagram Carousel] Контейнер создан успешно, ID: ${containerId}`);
      return containerId;
    } else {
      throw new Error('Ответ не содержит ID контейнера');
    }
  } catch (error) {
    log(`[Instagram Carousel] Ошибка при создании контейнера: ${error.message}`);
    if (axios.isAxiosError(error) && error.response) {
      log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Обработчик для создания контейнера карусели
async function createCarouselContainer(containerIds: string[], caption: string, token: string, businessAccountId: string) {
  try {
    log(`[Instagram Carousel] Создание контейнера карусели с ${containerIds.length} изображениями`);
    
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
      const containerId = response.data.id;
      log(`[Instagram Carousel] Контейнер карусели создан успешно, ID: ${containerId}`);
      return containerId;
    } else {
      throw new Error('Ответ не содержит ID контейнера карусели');
    }
  } catch (error) {
    log(`[Instagram Carousel] Ошибка при создании контейнера карусели: ${error.message}`);
    if (axios.isAxiosError(error) && error.response) {
      log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Обработчик для публикации карусели
async function publishCarousel(carouselContainerId: string, token: string, businessAccountId: string) {
  try {
    log(`[Instagram Carousel] Публикация карусели, контейнер ID: ${carouselContainerId}`);
    
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
      return postId;
    } else {
      throw new Error('Ответ не содержит ID публикации');
    }
  } catch (error) {
    log(`[Instagram Carousel] Ошибка при публикации карусели: ${error.message}`);
    if (axios.isAxiosError(error) && error.response) {
      log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Обработчик для получения постоянной ссылки
async function getPermalink(postId: string, token: string) {
  try {
    log(`[Instagram Carousel] Получение постоянной ссылки для публикации: ${postId}`);
    
    const response = await axios.get(
      `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${token}`
    );
    
    if (response.data && response.data.permalink) {
      const permalink = response.data.permalink;
      log(`[Instagram Carousel] Постоянная ссылка на публикацию: ${permalink}`);
      return permalink;
    } else {
      throw new Error('Не удалось получить постоянную ссылку');
    }
  } catch (error) {
    log(`[Instagram Carousel] Ошибка при получении ссылки: ${error.message}`);
    if (axios.isAxiosError(error) && error.response) {
      log(`[Instagram Carousel] Детали ошибки: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// Основной маршрут для обработки карусели
router.post('/api/instagram-carousel', async (req: Request, res: Response) => {
  try {
    log(`[Instagram Carousel] Получен запрос на публикацию карусели`);
    
    const { contentId, caption, imageUrls, token, businessAccountId } = req.body;
    
    if (!contentId || !imageUrls || !Array.isArray(imageUrls) || imageUrls.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать contentId и не менее 2-х изображений'
      });
    }
    
    // 1. Создание контейнеров для изображений
    const containerIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      try {
        const containerId = await createImageContainer(imageUrl, token, businessAccountId);
        containerIds.push(containerId);
        
        // Задержка между запросами
        await delay(3000);
      } catch (error) {
        log(`[Instagram Carousel] Ошибка при создании контейнера для изображения ${i+1}: ${error.message}`);
        return res.status(500).json({
          success: false,
          error: `Ошибка при создании контейнера: ${error.message}`
        });
      }
    }
    
    log(`[Instagram Carousel] Созданы контейнеры для ${containerIds.length} изображений`);
    
    // Задержка перед созданием карусели
    await delay(5000);
    
    // 2. Создание контейнера карусели
    let carouselContainerId;
    try {
      carouselContainerId = await createCarouselContainer(containerIds, caption, token, businessAccountId);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `Ошибка при создании контейнера карусели: ${error.message}`
      });
    }
    
    // Задержка перед публикацией
    await delay(5000);
    
    // 3. Публикация карусели
    let postId;
    try {
      postId = await publishCarousel(carouselContainerId, token, businessAccountId);
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `Ошибка при публикации карусели: ${error.message}`
      });
    }
    
    // 4. Получение постоянной ссылки
    let permalink = null;
    try {
      permalink = await getPermalink(postId, token);
    } catch (error) {
      log(`[Instagram Carousel] Не удалось получить ссылку, но публикация успешна: ${error.message}`);
    }
    
    // 5. Возврат результата
    return res.status(200).json({
      success: true,
      contentId,
      postId,
      permalink,
      message: 'Карусель успешно опубликована'
    });
    
  } catch (error) {
    log(`[Instagram Carousel] Критическая ошибка: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: `Внутренняя ошибка сервера: ${error.message}`
    });
  }
});

export default router;
```

### 1.2. Регистрация маршрута для обработки карусели в `server/routes.ts`

```typescript
// В начале файла, в секции импортов
import instagramCarouselRouter from './api/instagram-carousel-webhook';

// В функции registerRoutes, до создания HTTP сервера
app.use('/api', instagramCarouselRouter);
log('Instagram carousel webhook registered');
```

## 2. Добавление функционала в сервис публикации

### 2.1. Обновление класса `SocialPublishingWithImgurService` в `server/services/social-publishing-with-imgur.ts`

Добавить метод для публикации карусели:

```typescript
/**
 * Публикует карусель в Instagram с использованием Graph API
 * @param content Контент для публикации
 * @param instagramSettings Настройки Instagram API
 * @returns Результат публикации
 */
async publishInstagramCarousel(
  content: CampaignContent,
  instagramSettings: SocialPlatformSettings
): Promise<SocialPublication> {
  try {
    log('Публикация карусели в Instagram');
    
    // Проверка наличия изображений для карусели
    const mainImageUrl = content.imageUrl;
    let additionalImages = content.additionalImages || [];
    
    // Обработка дополнительных изображений
    if (typeof additionalImages === 'string') {
      try {
        additionalImages = JSON.parse(additionalImages);
      } catch (e) {
        additionalImages = [];
      }
    }
    
    // Проверка, что это массив
    if (!Array.isArray(additionalImages)) {
      additionalImages = [];
    }
    
    // Собираем все изображения
    const allImages = mainImageUrl ? [mainImageUrl, ...additionalImages] : [...additionalImages];
    
    // Нужно как минимум 2 изображения для карусели
    if (allImages.length < 2) {
      throw new Error(
        'Для публикации карусели необходимо как минимум 2 изображения. ' +
        'Убедитесь, что контент содержит основное изображение и хотя бы одно дополнительное.'
      );
    }
    
    // Загрузка изображений на Imgur, если нужно
    const imagesWithImgur = [];
    for (const imageUrl of allImages) {
      try {
        const imgurUrl = await this.uploadImageToImgur(imageUrl);
        if (imgurUrl) {
          imagesWithImgur.push(imgurUrl);
        } else {
          imagesWithImgur.push(imageUrl);
        }
      } catch (error) {
        log(`Ошибка при загрузке изображения на Imgur: ${error.message}`);
        imagesWithImgur.push(imageUrl);
      }
    }
    
    // Подготовка текста для публикации
    const caption = content.content || '';
    
    // Публикация через API
    const response = await axios.post(
      `${this.getAppBaseUrl()}/api/instagram-carousel`,
      {
        contentId: content.id,
        caption,
        imageUrls: imagesWithImgur,
        token: instagramSettings.token,
        businessAccountId: instagramSettings.businessAccountId
      }
    );
    
    if (response.data.success) {
      return {
        status: 'published',
        postId: response.data.postId,
        postUrl: response.data.permalink || '',
        platform: 'instagram',
        error: null,
        publishedAt: new Date().toISOString()
      };
    } else {
      throw new Error(response.data.error || 'Неизвестная ошибка при публикации карусели');
    }
  } catch (error) {
    log(`Ошибка при публикации карусели в Instagram: ${error.message}`);
    return {
      status: 'failed',
      postId: null,
      postUrl: null,
      platform: 'instagram',
      error: error.message,
      publishedAt: null
    };
  }
}
```

### 2.2. Обновление метода `publishToPlatform` для поддержки карусели

```typescript
async publishToPlatform(
  content: CampaignContent,
  platform: SocialPlatform,
  settings: SocialMediaSettings
): Promise<SocialPublication> {
  try {
    log(`Публикация контента в ${platform}`);
    
    let result: SocialPublication;
    
    switch (platform) {
      // ...другие платформы
      
      case 'instagram':
        // Проверяем, нужно ли публиковать как карусель
        const hasAdditionalImages = 
          content.additionalImages && 
          (Array.isArray(content.additionalImages) ? 
            content.additionalImages.length > 0 : 
            typeof content.additionalImages === 'string' && 
            content.additionalImages !== '[]');
        
        if (hasAdditionalImages) {
          // Публикуем как карусель
          result = await this.publishInstagramCarousel(content, settings.instagram);
        } else {
          // Публикуем как обычный пост
          result = await this.publishToInstagram(content, settings.instagram);
        }
        break;
      
      // ...другие платформы
      
      default:
        throw new Error(`Неподдерживаемая платформа: ${platform}`);
    }
    
    return result;
  } catch (error) {
    log(`Ошибка при публикации в ${platform}: ${error.message}`);
    return {
      status: 'failed',
      postId: null,
      postUrl: null,
      platform,
      error: error.message,
      publishedAt: null
    };
  }
}
```

## 3. Проверка конфигурации и переменных окружения

Убедитесь, что в `.env` файле указаны необходимые переменные:

```
# Instagram API Configuration
INSTAGRAM_TOKEN="EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R"
INSTAGRAM_BUSINESS_ACCOUNT_ID="17841422577074562"
```

## 4. Тестирование интеграции

Для тестирования интеграции можно использовать следующий скрипт:

**Файл:** `test-instagram-carousel.js`

```javascript
import axios from 'axios';
import { config } from 'dotenv';

// Загружаем переменные окружения
config();

// Тестовые данные
const TEST_CONTENT_ID = 'test-carousel-id';
const TEST_IMAGES = [
  'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png',
  'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png'
];
const TEST_CAPTION = 'Тестовая карусель #тест #instagram';

// API URL
const API_URL = process.env.REPLIT_URL || 'http://localhost:5000';

// Тестирование публикации карусели
async function testCarouselPublication() {
  try {
    console.log('Тестирование API публикации карусели в Instagram');
    
    const response = await axios.post(
      `${API_URL}/api/instagram-carousel`,
      {
        contentId: TEST_CONTENT_ID,
        caption: TEST_CAPTION,
        imageUrls: TEST_IMAGES,
        token: process.env.INSTAGRAM_TOKEN,
        businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
      }
    );
    
    console.log('Результат публикации карусели:');
    console.log(response.data);
    
    if (response.data.success) {
      console.log('✅ Тест успешно завершен!');
    } else {
      console.log('❌ Ошибка при тестировании карусели');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:');
    console.error(error.message);
    if (error.response) {
      console.error('Детали ошибки:');
      console.error(error.response.data);
    }
  }
}

// Запуск теста
testCarouselPublication();
```

## 5. Итоговая структура файлов

После внедрения функционала карусели Instagram структура файлов должна включать:

```
server/
  ├── api/
  │   ├── instagram-carousel-webhook.ts (новый файл)
  │   └── ... (существующие файлы)
  ├── services/
  │   ├── social-publishing-with-imgur.ts (обновлённый файл)
  │   └── ... (существующие файлы)
  ├── routes.ts (обновлённый файл)
  └── ... (существующие файлы)
test-instagram-carousel.js (новый файл для тестирования)
```

## 6. Заключение

Интеграция Instagram карусели в SMM Manager требует следующих шагов:

1. Создание специального API-маршрута для обработки запросов на публикацию карусели
2. Обновление существующего сервиса публикации для поддержки карусельного формата
3. Обеспечение наличия необходимых переменных окружения и токенов
4. Тестирование интеграции с помощью специального скрипта

Важно учитывать особенности работы Instagram API, в частности необходимость задержек между запросами и правильной обработки ошибок.