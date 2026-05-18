/**
 * API клиент для реального видео конвертера
 */

export interface VideoConversionResult {
  success: boolean;
  convertedUrl?: string;
  originalUrl?: string;
  duration?: number;
  metadata?: {
    width: number;
    height: number;
    duration: number;
    codec: string;
    size: number;
  };
  contentUpdated?: boolean;
  method?: 'ffmpeg_conversion' | 'no_conversion_needed';
  message?: string;
  error?: string;
}

export interface ConversionStatus {
  success: boolean;
  ffmpegAvailable: boolean;
  message: string;
  version?: string;
}

/**
 * Конвертирует видео для Instagram Stories
 */
export async function convertVideoForInstagramStories(
  videoUrl: string,
  contentId?: string
): Promise<VideoConversionResult> {
  const token = localStorage.getItem('authToken');
  
  const response = await fetch('/api/real-video-converter/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: JSON.stringify({
      videoUrl,
      contentId
    })
  });

  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || 'Conversion failed');
  }

  return result;
}

/**
 * Конвертирует видео для конкретного контента по ID
 */
export async function convertContentVideo(contentId: string): Promise<VideoConversionResult> {
  const token = localStorage.getItem('authToken');
  
  const response = await fetch('/api/real-video-converter/convert-content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: JSON.stringify({
      contentId
    })
  });

  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || 'Content conversion failed');
  }

  return result;
}

/**
 * Проверяет статус видео конвертера
 */
export async function getConverterStatus(): Promise<ConversionStatus> {
  const response = await fetch('/api/real-video-converter/status');
  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || 'Failed to get converter status');
  }

  return result;
}

/**
 * Проверяет, нужна ли конвертация видео
 */
export function needsVideoConversion(videoUrl: string): boolean {
  if (!videoUrl) return false;
  
  const url = videoUrl.toLowerCase();
  
  // Если уже содержит метку конвертации - пропускаем
  if (url.includes('_converted') || url.includes('ig_stories_converted')) {
    return false;
  }
  
  // Конвертируем все форматы для Instagram Stories
  return true;
}

/**
 * Форматирует размер файла для отображения
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Форматирует длительность видео
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}