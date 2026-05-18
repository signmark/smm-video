import { generateStoriesImage, uploadImageToImgbb } from './storiesImageUtils';
import { apiRequest } from '@/lib/queryClient';

export interface PublishWithImageGenerationOptions {
  contentId: string;
  platforms: string[];
  story: any;
}

/**
 * Упрощенная функция публикации Stories с генерацией медиа
 *
 * Логика:
 * - Если video_url есть, а image_url пустой → это видео (генерация на сервере)
 * - Если есть textOverlays и изображение → генерируем изображение на клиенте
 * - Сервер сам определит тип медиа и обработает через StoriesMediaService
 */
export const publishWithImageGeneration = async (options: PublishWithImageGenerationOptions): Promise<any> => {
  const { contentId, platforms, story } = options;

  console.log('[PUBLISH] Публикация Stories:', { contentId, platforms });

  try {
    // Определяем тип медиа (видео если есть video_url и нет image_url)
    const isVideo = !!story.video_url && !story.image_url;

    // Получаем textOverlays из metadata
    let textOverlays = story.textOverlays;
    if (!textOverlays && story.metadata) {
      try {
        const metadata = typeof story.metadata === 'string' ? JSON.parse(story.metadata) : story.metadata;
        textOverlays = metadata.textOverlays || [];
      } catch (e) {
        textOverlays = [];
      }
    }

    let generatedImageUrl = null;
    const hasTextOverlays = textOverlays && textOverlays.length > 0;

    // Для изображений с текстом - генерируем на клиенте
    if (!isVideo && hasTextOverlays) {
      console.log('[PUBLISH] Генерация изображения с текстом на клиенте...');

      const storyForGeneration = {
        ...story,
        textOverlays
      };

      const base64Image = await generateStoriesImage(storyForGeneration);
      generatedImageUrl = await uploadImageToImgbb(base64Image, story.title || 'Generated Story');

      console.log('[PUBLISH] Изображение сгенерировано:', generatedImageUrl);
    } else if (isVideo && hasTextOverlays) {
      console.log('[PUBLISH] Видео с текстом - генерация будет на сервере');
    }

    // Отправляем на публикацию через системный apiRequest
    // Это автоматически добавит Authorization заголовок и обработает ошибки
    const result = await apiRequest('/api/stories/publish', {
      method: 'POST',
      data: {
        contentId,
        platforms,
        generatedImageUrl,
        useGeneratedImage: !!generatedImageUrl,
        useGeneratedVideo: isVideo && hasTextOverlays, // Для видео с текстом сервер сгенерирует
      }
    });

    console.log('[PUBLISH] Публикация завершена:', result);

    return {
      ...result,
      generatedImageUrl,
      imageGenerated: !!generatedImageUrl,
    };

  } catch (error) {
    console.error('[PUBLISH] Ошибка:', error);
    throw error;
  }
};
