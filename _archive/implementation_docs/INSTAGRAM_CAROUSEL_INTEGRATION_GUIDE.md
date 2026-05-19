# Инструкция по интеграции Instagram карусели

## Обзор процесса

Публикация карусели в Instagram через Graph API требует последовательного выполнения следующих шагов:

1. Создание контейнеров для каждого отдельного изображения карусели
2. Создание контейнера карусели, объединяющего все изображения
3. Публикация контейнера карусели
4. Получение постоянной ссылки на опубликованный пост

## Настройка окружения

### Необходимые переменные окружения

```
# Facebook/Instagram API
INSTAGRAM_TOKEN="EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R"
INSTAGRAM_BUSINESS_ACCOUNT_ID="17841422577074562"
```

## Пример кода для публикации карусели

```javascript
import axios from 'axios';

// Настройки Instagram API
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Изображения и подпись
const IMAGE_URLS = [
  'https://v3.fal.media/files/rabbit/TOLFCrYadFmSqJ5WwwYE-.png',
  'https://v3.fal.media/files/lion/W-HNg-Ax1vlVUVAXoNAva.png'
];
const CAPTION = 'Тестовая карусель #тест #instagram';

// Задержка между запросами
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Шаг 1: Создание контейнеров для изображений
async function createImageContainers(imageUrls) {
  const containerIds = [];
  
  for (const imageUrl of imageUrls) {
    console.log(`Создание контейнера для изображения: ${imageUrl}`);
    
    const response = await axios({
      method: 'post',
      url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      data: {
        access_token: INSTAGRAM_TOKEN,
        image_url: imageUrl,
        is_carousel_item: true
      }
    });
    
    if (response.data && response.data.id) {
      const containerId = response.data.id;
      console.log(`Контейнер создан: ${containerId}`);
      containerIds.push(containerId);
    }
    
    // Задержка между запросами
    await delay(5000);
  }
  
  return containerIds;
}

// Шаг 2: Создание контейнера карусели
async function createCarouselContainer(containerIds, caption) {
  console.log(`Создание контейнера карусели: ${containerIds.join(', ')}`);
  
  const response = await axios({
    method: 'post',
    url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
    data: {
      access_token: INSTAGRAM_TOKEN,
      media_type: 'CAROUSEL',
      children: containerIds.join(','),
      caption: caption
    }
  });
  
  if (response.data && response.data.id) {
    return response.data.id;
  }
  
  return null;
}

// Шаг 3: Публикация карусели
async function publishCarousel(carouselContainerId) {
  console.log(`Публикация карусели: ${carouselContainerId}`);
  
  const response = await axios({
    method: 'post',
    url: `https://graph.facebook.com/v16.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
    data: {
      access_token: INSTAGRAM_TOKEN,
      creation_id: carouselContainerId
    }
  });
  
  if (response.data && response.data.id) {
    return response.data.id;
  }
  
  return null;
}

// Шаг 4: Получение постоянной ссылки
async function getPostPermalink(postId) {
  console.log(`Получение ссылки для поста: ${postId}`);
  
  const response = await axios.get(
    `https://graph.facebook.com/v16.0/${postId}?fields=permalink&access_token=${INSTAGRAM_TOKEN}`
  );
  
  if (response.data && response.data.permalink) {
    return response.data.permalink;
  }
  
  return null;
}

// Основная функция публикации
async function publishInstagramCarousel() {
  try {
    // 1. Создание контейнеров для изображений
    const containerIds = await createImageContainers(IMAGE_URLS);
    
    // Важная задержка перед созданием карусели
    await delay(10000);
    
    // 2. Создание контейнера карусели
    const carouselContainerId = await createCarouselContainer(containerIds, CAPTION);
    if (!carouselContainerId) {
      throw new Error('Не удалось создать контейнер карусели');
    }
    
    // Важная задержка перед публикацией
    await delay(10000);
    
    // 3. Публикация карусели
    const postId = await publishCarousel(carouselContainerId);
    if (!postId) {
      throw new Error('Не удалось опубликовать карусель');
    }
    
    // 4. Получение постоянной ссылки
    const permalink = await getPostPermalink(postId);
    
    return {
      success: true,
      postId,
      permalink
    };
    
  } catch (error) {
    console.error(`Ошибка публикации карусели: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}
```

## Важные замечания

1. **Задержки между запросами**: Instagram API требует определенного времени для обработки запросов. Рекомендуется делать паузы (5-10 секунд) между последовательными операциями.

2. **Параметр `is_carousel_item`**: Для изображений, которые будут использоваться в карусели, этот параметр должен быть установлен в `true`.

3. **Версия API**: Для карусели рекомендуется использовать версию 16.0 или выше Facebook Graph API.

4. **Типы изображений**: Убедитесь, что все изображения доступны по URL и имеют поддерживаемый формат (JPEG, PNG).

5. **Ограничения контента**: Карусель может содержать до 10 изображений, минимум 2. Размер каждого изображения не должен превышать 8 МБ.

## Обработка ошибок

В случае возникновения ошибок при публикации, важно проверить:

1. **Актуальность токена**: Токен Instagram может быть истекшим или иметь недостаточные права.

2. **Доступность изображений**: Все изображения должны быть доступны по указанным URL.

3. **Формат контейнеров**: ID контейнеров должны быть правильно подготовлены для создания карусели.

4. **Лимиты API**: Instagram имеет ограничения на количество запросов, которые можно сделать в определенный период времени.

## Интеграция в SMM Manager

Для интеграции в существующую систему:

1. Создайте сервис в серверной части, который будет выполнять последовательность создания и публикации карусели.

2. Добавьте обработку ошибок и логирование на каждом этапе.

3. Учитывайте задержки между запросами для обеспечения стабильной работы.

4. В случае таймаутов, реализуйте логику восстановления операции при следующем запуске.

---

## Полезные ссылки

- [Facebook Graph API для Instagram](https://developers.facebook.com/docs/instagram-api)
- [Документация по публикации в Instagram](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [Ограничения и известные проблемы API Instagram](https://developers.facebook.com/docs/instagram-api/reference/ig-user/media)