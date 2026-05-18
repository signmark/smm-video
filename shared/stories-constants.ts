/**
 * Константы для работы со Stories
 * Единый источник истины для размеров, масштабирования и конфигурации
 */

// Размеры превью Stories (базовая сетка, в которой хранятся координаты в БД)
// В редакторе используется 280x497 с коэффициентом 0.8 (280 / 0.8 = 350)
export const STORIES_PREVIEW_DIMENSIONS = {
  WIDTH: 350,
  HEIGHT: 621,
} as const;

// Размеры Instagram Stories (финальный формат для публикации)
export const INSTAGRAM_STORIES_DIMENSIONS = {
  WIDTH: 1080,
  HEIGHT: 1920,
} as const;

// Коэффициенты масштабирования из превью в Instagram формат
export const STORIES_SCALE_FACTORS = {
  X: INSTAGRAM_STORIES_DIMENSIONS.WIDTH / STORIES_PREVIEW_DIMENSIONS.WIDTH, // 3.857
  Y: INSTAGRAM_STORIES_DIMENSIONS.HEIGHT / STORIES_PREVIEW_DIMENSIONS.HEIGHT, // 3.863
} as const;

// Типы медиа в additional_media
export const ADDITIONAL_MEDIA_TYPES = {
  GENERATED_IMAGE: 'generated_image',
  GENERATED_VIDEO: 'generated_video',
  INSTAGRAM_READY_IMAGE: 'instagram_ready_image',
  UPLOADED_VIDEO: 'uploaded_video',
} as const;

// Типы медиа Stories
export const STORY_MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
} as const;

/**
 * Определяет тип медиа на основе URL
 * Логика: если есть video_url, а image_url пустой → это видео
 */
export function getStoryMediaType(story: { video_url?: string | null; image_url?: string | null }): 'video' | 'image' {
  return story.video_url && !story.image_url ? STORY_MEDIA_TYPES.VIDEO : STORY_MEDIA_TYPES.IMAGE;
}

/**
 * Масштабирует координаты из превью в Instagram формат
 */
export function scaleCoordinatesToInstagram(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x * STORIES_SCALE_FACTORS.X),
    y: Math.round(y * STORIES_SCALE_FACTORS.Y),
  };
}

/**
 * Масштабирует размер шрифта из превью в Instagram формат
 */
export function scaleFontSizeToInstagram(fontSize: number): number {
  return Math.round(fontSize * STORIES_SCALE_FACTORS.X);
}

/**
 * Масштабирует text overlay из превью в Instagram формат
 */
export interface TextOverlay {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  backgroundColor?: string;
  rotation?: number;
  startTime?: number;
  endTime?: number;
}

export function scaleTextOverlayToInstagram(overlay: TextOverlay): TextOverlay {
  const scaled = scaleCoordinatesToInstagram(overlay.x, overlay.y);
  return {
    ...overlay,
    x: scaled.x,
    y: scaled.y,
    fontSize: scaleFontSizeToInstagram(overlay.fontSize),
    fontFamily: overlay.fontFamily || 'Arial',
    startTime: overlay.startTime || 0,
    endTime: overlay.endTime || 60,
  };
}
