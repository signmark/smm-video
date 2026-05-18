/**
 * Создает проксированный URL для загрузки изображений/видео через серверный прокси
 * с учетом специфики разных источников (Instagram, VK, Telegram)
 */
export function createProxyImageUrl(imageUrl: string, itemId: string): string {
  // Если URL пустой или undefined, возвращаем пустую строку
  if (!imageUrl) return '';
  
  // Добавляем cache-busting параметр
  const timestamp = Date.now();
  
  // Определяем тип источника (Instagram, VK, etc)
  const isInstagram = imageUrl.includes('instagram.') || 
                     imageUrl.includes('fbcdn.net') || 
                     imageUrl.includes('cdninstagram.com') ||
                     imageUrl.includes('scontent.') || // Домены scontent часто используются CDN Instagram
                     (imageUrl.includes('.jpg') && 
                      (imageUrl.includes('ig_') || 
                       imageUrl.includes('instagram')));
  
  const isVk = imageUrl.includes('vk.com') || 
               imageUrl.includes('vk.me') || 
               imageUrl.includes('userapi.com');
  
  const isTelegram = imageUrl.includes('tgcnt.ru') || 
                    imageUrl.includes('t.me');
  
  // Формируем параметры для прокси
  let forcedType = isInstagram ? 'instagram' : 
                  isVk ? 'vk' : 
                  isTelegram ? 'telegram' : null;
  
  // Базовый URL прокси с параметрами
  return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}&_t=${timestamp}${forcedType ? '&forceType=' + forcedType : ''}&itemId=${itemId}`;
}

/**
 * Создает проксированный URL для получения превью из видео
 * Используется для генерации миниатюр видео в трендах
 */
export function createVideoThumbnailUrl(videoUrl: string, itemId: string): string {
  // Если URL пустой или undefined, возвращаем пустую строку
  if (!videoUrl) return '';
  
  // Добавляем cache-busting параметр
  const timestamp = Date.now();
  
  // Используем специальный параметр isVideo для указания, что это запрос на превью видео
  return `/api/proxy-image?url=${encodeURIComponent(videoUrl)}&isVideo=true&_t=${timestamp}&itemId=${itemId}`;
}

/**
 * Создает URL для потоковой передачи видео через новый API эндпоинт
 * Поддерживает все типы видео с автоматическим определением формата
 */
export function createStreamVideoUrl(videoUrl: string, itemId: string, forceType?: string): string {
  // Если URL пустой или undefined, возвращаем пустую строку
  if (!videoUrl) return '';
  
  // Добавляем cache-busting параметр
  const timestamp = Date.now();
  
  // Определяем тип источника, если не указан явно
  if (!forceType) {
    const isInstagram = videoUrl.includes('instagram.') || 
                       videoUrl.includes('fbcdn.net') || 
                       videoUrl.includes('cdninstagram.com') ||
                       videoUrl.includes('scontent.') || // Домены scontent часто используются CDN Instagram
                       (videoUrl.includes('.mp4') && 
                        (videoUrl.includes('ig_') || videoUrl.includes('instagram'))) ||
                       videoUrl.includes('HBksFQIYUmlnX') || // Характерная часть URL Instagram видео
                       videoUrl.includes('_nc_vs=') ||       // Другой маркер Instagram видео
                       videoUrl.includes('efg=');
    
    const isVk = videoUrl.includes('vk.com') || 
                videoUrl.includes('vk.me') || 
                videoUrl.includes('userapi.com');
    
    const isTelegram = videoUrl.includes('tgcnt.ru') || 
                      videoUrl.includes('t.me');
                      
    const isDirectVideo = videoUrl.endsWith('.mp4') || 
                         videoUrl.endsWith('.webm') || 
                         videoUrl.endsWith('.mov');
    
    forceType = isInstagram ? 'instagram' : 
               isVk ? 'vk' : 
               isTelegram ? 'telegram' : 
               isDirectVideo ? 'directVideo' : undefined;
  }
  
  // Instagram видео будет проксироваться через наш собственный сервер
  // Мы не меняем логику для Instagram, так как это обрабатывается на уровне UI
  // и возвращаем стандартный stream-video URL
  
  // Формируем URL для стриминга видео
  let streamUrl = `/api/stream-video?url=${encodeURIComponent(videoUrl)}&_t=${timestamp}&itemId=${itemId}`;
  
  // Добавляем тип видео, если он был определен
  if (forceType) {
    streamUrl += `&forceType=${forceType}`;
  }
  
  return streamUrl;
}

/**
 * Проверяет, является ли URL ссылкой на видео
 * по расширению файла или доменному имени
 */
export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  
  // Нормализуем URL для проверки
  const normalizedUrl = url.toLowerCase();
  
  // Проверка по расширению файла
  const hasVideoExtension = normalizedUrl.endsWith('.mp4') || 
                          normalizedUrl.endsWith('.webm') || 
                          normalizedUrl.endsWith('.avi') || 
                          normalizedUrl.endsWith('.mov') || 
                          normalizedUrl.endsWith('.mkv') || 
                          normalizedUrl.endsWith('.wmv');
  
  // Проверка по ссылкам на видео ВКонтакте
  const isVkVideo = normalizedUrl.includes('vk.com/video') || 
                   // Формат video-GROUPID_VIDEOID
                   /vk\.com\/video-\d+_\d+/.test(normalizedUrl);
  
  // Проверка на Instagram видео
  const isInstagramVideo = normalizedUrl.includes('instagram.') && 
                        (normalizedUrl.includes('_nc_vs=') || 
                         normalizedUrl.includes('fbcdn.net') && normalizedUrl.includes('.mp4') ||
                         normalizedUrl.includes('cdninstagram.com') && normalizedUrl.includes('.mp4') ||
                         normalizedUrl.includes('scontent.') && normalizedUrl.includes('.mp4') ||
                         normalizedUrl.includes('efg=') ||
                         normalizedUrl.includes('HBksFQIYUmlnX'));

  // Проверка по доменам видеохостингов
  const isVideoHosting = normalizedUrl.includes('youtube.com/watch') || 
                        normalizedUrl.includes('youtu.be/') || 
                        normalizedUrl.includes('vimeo.com/') || 
                        isVkVideo ||
                        isInstagramVideo ||
                        (normalizedUrl.includes('tgcnt.ru') && normalizedUrl.includes('.mp4'));
  
  return hasVideoExtension || isVideoHosting;
}