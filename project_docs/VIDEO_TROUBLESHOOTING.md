# Руководство по отладке видео-загрузок и проблем с медиа-файлами

## Частые проблемы и их решения

### 1. Ошибка 401 Unauthorized при загрузке видео

**Симптомы:**
- В консоли браузера отображается ошибка 401
- Сервер возвращает сообщение `Не авторизован: Отсутствует заголовок Authorization`

**Решение:**
1. Проверить корректность названия токена в localStorage:
   ```javascript
   // Правильный способ получения токена
   const token = localStorage.getItem('auth_token');
   ```

2. Убедиться, что токен передается в заголовках запроса:
   ```javascript
   axios.post('/api/beget-s3-video/upload', formData, {
     headers: {
       'Content-Type': 'multipart/form-data',
       'Authorization': `Bearer ${token}`
     }
   });
   ```

3. Проверить актуальность токена, при необходимости обновить его через API:
   ```javascript
   // Обновление токена через refresh_token
   const refreshToken = localStorage.getItem('refresh_token');
   if (refreshToken) {
     const response = await fetch('/api/auth/refresh', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ refreshToken })
     });
     const data = await response.json();
     localStorage.setItem('auth_token', data.access_token);
   }
   ```

### 2. Видео загружается, но не отображается в превью

**Симптомы:**
- В консоли показывается успешная загрузка и получение URL
- Превью видео не отображается или показывает ошибку

**Решение:**
1. Проверить CORS настройки в S3 хранилище Beget:
   - Убедиться, что к бакету разрешен публичный доступ для чтения
   - Проверить, что CORS-политика настроена правильно

2. Проверить формат URL и его доступность напрямую:
   ```javascript
   // Тестирование доступности видео-URL
   fetch(videoUrl, { method: 'HEAD' })
     .then(response => console.log('Video URL is accessible:', response.ok))
     .catch(error => console.error('Video URL is not accessible:', error));
   ```

3. Убедиться, что формат видео поддерживается браузером (MP4, WebM):
   ```javascript
   // Проверка расширения файла
   function isValidVideoFormat(url) {
     const ext = url.split('.').pop().toLowerCase();
     return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
   }
   ```

### 3. Проблемы сохранения видео в поле additional_media

**Симптомы:**
- Видео добавляется в интерфейсе, но не сохраняется в базе данных
- Видео исчезает после перезагрузки страницы

**Решение:**
1. Убедиться, что поле `additionalMedia` корректно устанавливается:
   ```javascript
   setCurrentContentSafe({...currentContent, additionalMedia: media});
   ```

2. Проверить, что поле `additionalMedia` включено в запрос на обновление:
   ```javascript
   const updateData = {
     // ...другие поля
     additionalMedia: currentContent.additionalMedia || []
   };
   ```

3. Проверить структуру объекта в поле `additionalMedia`:
   ```javascript
   // Правильная структура
   const mediaItem = {
     url: videoUrl,
     type: 'video',
     title: 'Название видео',
     description: 'Описание видео'
   };
   ```

## Рекомендации по отладке

### Логирование

Добавьте расширенное логирование для отслеживания процесса загрузки:

```javascript
// В компоненте VideoUploader
console.log('Отправка запроса на загрузку видео файла...', {
  fileSize: file.size,
  fileType: file.type,
  fileName: file.name
});

// После получения ответа
console.log('Ответ от API загрузки видео:', {
  success: response.data.success,
  url: response.data.url || response.data.videoUrl,
  responseStatus: response.status
});
```

### Инспекция сетевых запросов

1. Используйте инструменты разработчика браузера (вкладка Network) для анализа запросов:
   - Проверьте заголовки запроса (наличие token)
   - Проверьте содержимое FormData (наличие файла)
   - Проверьте ответ сервера (формат и содержимое)

2. Для отладки можно использовать промежуточные запросы для проверки статуса файла:
   ```javascript
   // Проверка метаданных загруженного видео
   fetch(videoUrl)
     .then(response => {
       console.log('Content-Type:', response.headers.get('Content-Type'));
       console.log('Content-Length:', response.headers.get('Content-Length'));
       return response.blob();
     })
     .then(blob => console.log('File size:', blob.size, 'Type:', blob.type));
   ```

## Проверка на сервере

Для отладки проблем на стороне сервера используйте следующие команды:

```bash
# Проверка доступа к Beget S3
curl -v https://s3.ru1.storage.beget.cloud/6e679636ae90-ridiculous-seth/test.txt

# Проверка прав доступа к директории с временными файлами
ls -la /tmp

# Проверка логов сервера на наличие ошибок загрузки
grep "upload" server.log | tail -50
```

## Контрольный список для проверки

✓ Токен авторизации корректно получается из localStorage
✓ Заголовок Authorization добавляется к запросу 
✓ FormData содержит файл с правильным именем поля (file)
✓ Сервер возвращает JSON-ответ с полями success и url/videoUrl
✓ URL видео доступен напрямую в браузере
✓ Формат видео поддерживается браузером для воспроизведения
✓ Объект MediaItem имеет корректную структуру в additionalMedia
✓ Обновление additionalMedia включено в запрос PATCH