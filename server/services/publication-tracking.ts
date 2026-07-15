import { log } from '../utils/logger';
import axios from 'axios';

/**
 * Трекинг публикаций для предотвращения дублирования
 * Использует базу данных для персистентного хранения состояний
 */
export class PublicationTracker {
  private processedPublications = new Set<string>(); // contentId:platform
  private lockTimeout = 30 * 60 * 1000; // 30 минут на публикацию (было 10)
  
  /**
   * Проверяет, можно ли публиковать контент на платформе
   */
  async canPublish(contentId: string, platform: string): Promise<boolean> {
    const lockKey = `${contentId}:${platform}`;
    
    // Проверяем локальный кэш
    if (this.processedPublications.has(lockKey)) {
      log(`📊 TRACKING: Контент ${contentId} уже обрабатывается в ${platform} (локальный кэш)`, 'publication-tracker');
      return false;
    }
    
    // Проверяем статус в базе данных
    try {
      const authToken = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      if (!authToken) return true;
      
      const response = await axios.get(`${process.env.DIRECTUS_URL}/items/campaign_content/${contentId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'social_platforms'
        }
      });
      
      const content = response?.data?.data;
      if (!content?.social_platforms) return true;
      
      let platforms = content.social_platforms;
      if (typeof platforms === 'string') {
        platforms = JSON.parse(platforms);
      }
      
      const platformData = platforms[platform];
      if (!platformData) return true;
      
      // 🛑 АБСОЛЮТНАЯ БЛОКИРОВКА: Если есть postUrl - НИКОГДА не публиковать повторно
      // Это главная защита от дубликатов, независимо от статуса
      if (platformData.postUrl && platformData.postUrl.trim() !== '') {
        log(`🛑 АБСОЛЮТНАЯ БЛОКИРОВКА: ${platform} контент ${contentId} УЖЕ ИМЕЕТ postUrl: ${platformData.postUrl}`, 'publication-tracker');
        this.markAsProcessed(contentId, platform);
        return false;
      }
      
      // Если уже опубликован по статусу - блокируем
      if (platformData.status === 'published') {
        log(`📊 TRACKING: Контент ${contentId} УЖЕ ОПУБЛИКОВАН в ${platform} (статус published)`, 'publication-tracker');
        this.markAsProcessed(contentId, platform);
        return false;
      }
      
      // `pending` means queued, not currently publishing. Treating a recently scheduled
      // pending post as active could make the scheduler skip it for the full lock timeout.
      // Actual in-flight work uses `publishing` and is protected by the scheduler lock.
      
      return true;
      
    } catch (error: any) {
      log(`📊 TRACKING: Ошибка проверки статуса ${contentId}:${platform} - ${error.message}`, 'publication-tracker');
      return true; // В случае ошибки разрешаем публикацию
    }
  }
  
  /**
   * Отмечает контент как обрабатываемый
   */
  markAsProcessed(contentId: string, platform: string) {
    const lockKey = `${contentId}:${platform}`;
    this.processedPublications.add(lockKey);
    log(`📊 TRACKING: Отмечен как обрабатываемый ${lockKey}`, 'publication-tracker');
    
    // Автоматически удаляем через timeout
    setTimeout(() => {
      this.processedPublications.delete(lockKey);
      log(`📊 TRACKING: Блокировка снята для ${lockKey}`, 'publication-tracker');
    }, this.lockTimeout);
  }
  
  /**
   * Снимает блокировку с контента
   */
  releasePublication(contentId: string, platform: string) {
    const lockKey = `${contentId}:${platform}`;
    this.processedPublications.delete(lockKey);
    log(`📊 TRACKING: Принудительно снята блокировка ${lockKey}`, 'publication-tracker');
  }
  
  /**
   * Получает статистику трекинга
   */
  getStats() {
    return {
      activePublications: this.processedPublications.size,
      publicationsInProgress: Array.from(this.processedPublications)
    };
  }
}

// Синглтон для глобального использования
export const publicationTracker = new PublicationTracker();
