/**
 * Утилиты для генерации Stories видео с наложением текста
 */

export interface VideoTextOverlay {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  startTime: number;
  endTime: number;
}

export interface VideoStoryData {
  backgroundVideoUrl: string;
  textOverlays: Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color: string;
    fontFamily: string;
    rotation?: number;
  }>;
}

/**
 * Генерирует видео Stories с наложением текста
 */
export const generateStoriesVideo = async (story: VideoStoryData, campaignId?: string): Promise<string> => {
  console.log('[STORIES-VIDEO] Начинаем генерацию видео с текстом:', story);

  if (!story.backgroundVideoUrl) {
    throw new Error('URL видео не указан');
  }

  if (!story.textOverlays || story.textOverlays.length === 0) {
    console.log('[STORIES-VIDEO] Нет текстовых наложений, возвращаем оригинальное видео');
    return story.backgroundVideoUrl;
  }

  try {
    // Преобразуем textOverlays в формат для FFmpeg
    // Правильные коэффициенты масштабирования из превью (280x497) в Instagram Stories (1080x1920)
    const scaleX = 1080 / 280; // = 3.857
    const scaleY = 1920 / 497; // = 3.863 (исправлено!)
    
    const videoOverlays: VideoTextOverlay[] = story.textOverlays.map(overlay => ({
      text: overlay.text,
      x: Math.round(overlay.x * scaleX), // Масштабируем с 280px на 1080px
      y: Math.round(overlay.y * scaleY), // Масштабируем с 497px на 1920px (правильно!)
      fontSize: Math.round(overlay.fontSize * scaleX), // Масштабируем размер шрифта
      color: overlay.color,
      fontFamily: overlay.fontFamily || 'Arial',
      startTime: (overlay as any).startTime || 0, // Поддержка временных интервалов
      endTime: (overlay as any).endTime || 60     // Поддержка временных интервалов
    }));

    console.log('[STORIES-VIDEO] Отправляем на обработку видео:', {
      videoUrl: story.backgroundVideoUrl,
      overlays: videoOverlays
    });

    // Получаем токен авторизации
    const authToken = localStorage.getItem('auth_token') || 
                     localStorage.getItem('token') || 
                     localStorage.getItem('authToken');

    if (!authToken) {
      throw new Error('Токен авторизации не найден');
    }

    // Отправляем только URL видео и наложения на сервер для обработки
    // Сервер сам скачает видео и обработает его
    const requestData = {
      videoUrl: story.backgroundVideoUrl,
      textOverlays: videoOverlays,
      campaignId: campaignId
    };

    // Отправляем на обработку
    const response = await fetch('/api/video-processing/process-video-from-url', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка обработки видео: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result.success || !result.videoUrl) {
      throw new Error(result.error || 'Не удалось обработать видео');
    }

    console.log('[STORIES-VIDEO] Видео успешно обработано:', result.videoUrl);
    
    // Возвращаем полный URL
    const baseUrl = window.location.origin;
    return result.videoUrl.startsWith('http') 
      ? result.videoUrl 
      : `${baseUrl}${result.videoUrl}`;

  } catch (error) {
    console.error('[STORIES-VIDEO] Ошибка генерации видео:', error);
    throw error;
  }
};

/**
 * Загружает обработанное видео в S3 хранилище
 */
export const uploadVideoToS3 = async (videoUrl: string): Promise<string> => {
  console.log('[STORIES-VIDEO] Загружаем видео в S3:', videoUrl);

  try {
    const authToken = localStorage.getItem('auth_token') || 
                     localStorage.getItem('token') || 
                     localStorage.getItem('authToken');

    if (!authToken) {
      throw new Error('Токен авторизации не найден');
    }

    // Скачиваем обработанное видео
    const videoResponse = await fetch(videoUrl);
    const videoBlob = await videoResponse.blob();
    
    // Создаем FormData для загрузки в S3
    const formData = new FormData();
    const fileName = `story_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`;
    formData.append('video', videoBlob, fileName);

    const response = await fetch('/api/beget-s3/upload-video', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ошибка загрузки в S3: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result.success || !result.url) {
      throw new Error(result.error || 'Не удалось загрузить видео в S3');
    }

    console.log('[STORIES-VIDEO] Видео загружено в S3:', result.url);
    return result.url;

  } catch (error) {
    console.error('[STORIES-VIDEO] Ошибка загрузки в S3:', error);
    throw error;
  }
};