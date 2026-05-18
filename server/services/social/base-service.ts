import axios from 'axios';
import { log } from '../../utils/logger';
import { CampaignContent, SocialMediaSettings, SocialPlatform, SocialPublication } from '@shared/schema';
import { storage } from '../../storage';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { begetS3StorageAws } from '../beget-s3-storage-aws';

/**
 * Базовый класс для сервисов публикации в социальные сети
 */
export abstract class BaseSocialService {
  /**
   * Получает системный токен для доступа к API Directus
   * @returns Токен доступа или null в случае ошибки
   */
  protected async getSystemToken(): Promise<string | null> {
    try {
      const directusAuthManager = await import('../directus-auth-manager').then(m => m.directusAuthManager);
      const directusCrud = await import('../directus-crud').then(m => m.directusCrud);
      const adminUserId = '53921f16-f51d-4591-80b9-8caa4fde4d13';
      
      // Используем только системную авторизацию через DirectusAuthManager
      if (false) {
        log(`Попытка авторизации администратора с учетными данными из env`, 'social-publishing');
        try {
          // Используем метод login вместо loginUserWithCredentials
          const adminSession = await directusAuthManager.login(email, password);
          if (adminSession) {
            log(`Авторизация администратора успешна через прямой API запрос`, 'social-publishing');
            return adminSession.token;
          }
        } catch (e) {
          log(`Ошибка авторизации администратора: ${e}`, 'social-publishing');
        }
      }
      
      // 2. Вариант - использовать хранящуюся сессию администратора
      try {
        // Используем метод getSession вместо getUserSession
        const adminSession = directusAuthManager.getSession(adminUserId);
        if (adminSession && adminSession.token) {
          log(`Использование существующей авторизации администратора`, 'social-publishing');
          return adminSession.token;
        }
      } catch (e) {
        log(`Не удалось получить существующую сессию администратора: ${e}`, 'social-publishing');
      }
      
      return null;
    } catch (error) {
      log(`Ошибка получения системного токена: ${error}`, 'social-publishing');
      return null;
    }
  }

  /**
   * Обрабатывает поле дополнительных изображений в контенте, проверяя и преобразуя его при необходимости
   * @param content Контент, содержащий дополнительные изображения
   * @param platform Название социальной платформы (для логирования)
   * @returns Обновленный контент с обработанным полем additionalImages
   */
  protected processAdditionalImages(content: CampaignContent, platform: string): CampaignContent {
    const updatedContent = { ...content };
    
    try {
      // Проверяем наличие поля additionalImages и его формат
      if (updatedContent.additionalImages) {
        // Если additionalImages - это строка, пытаемся преобразовать её в массив
        if (typeof updatedContent.additionalImages === 'string') {
          try {
            // Пробуем распарсить JSON
            const parsedImages = JSON.parse(updatedContent.additionalImages);
            
            // Проверка, что parsedImages является массивом
            if (Array.isArray(parsedImages)) {
              updatedContent.additionalImages = parsedImages;
              log(`Строковое представление additionalImages преобразовано в массив для ${platform}, найдено ${parsedImages.length} изображений`, 'social-publishing');
            } else {
              // Если это не массив, но объект с полем, содержащим массив
              if (parsedImages && typeof parsedImages === 'object') {
                // Проверяем наличие полей, которые могут содержать массив изображений
                const possibleArrayFields = Object.keys(parsedImages).filter(key => 
                  Array.isArray(parsedImages[key])
                );
                
                if (possibleArrayFields.length > 0) {
                  // Используем первое найденное поле с массивом
                  updatedContent.additionalImages = parsedImages[possibleArrayFields[0]];
                  log(`Найден массив изображений в поле ${possibleArrayFields[0]}, содержит ${updatedContent.additionalImages.length} элементов`, 'social-publishing');
                } else {
                  // Если не нашли массив, создаем пустой
                  updatedContent.additionalImages = [];
                  log(`additionalImages преобразован в пустой массив для ${platform} (не удалось найти массив в объекте)`, 'social-publishing');
                }
              } else {
                // Если не удалось распознать формат, создаем пустой массив
                updatedContent.additionalImages = [];
                log(`additionalImages преобразован в пустой массив для ${platform} (неизвестный формат)`, 'social-publishing');
              }
            }
          } catch (error) {
            // Если не удалось распарсить JSON, считаем это одиночным URL и создаем массив с одним элементом
            // Обработка строки url
            const additionalImage = updatedContent.additionalImages as string;
            if (additionalImage && typeof additionalImage === 'string' && additionalImage.trim().startsWith('http')) {
              updatedContent.additionalImages = [additionalImage.trim()];
              log(`additionalImages в виде строки URL преобразован в массив с одним элементом для ${platform}`, 'social-publishing');
            } else {
              // Иначе создаем пустой массив
              updatedContent.additionalImages = [];
              log(`additionalImages преобразован в пустой массив для ${platform} (не удалось распарсить JSON)`, 'social-publishing');
            }
          }
        } 
        // Если additionalImages уже массив, проверяем его элементы
        else if (Array.isArray(updatedContent.additionalImages)) {
          // Фильтруем только строковые значения
          updatedContent.additionalImages = updatedContent.additionalImages.filter(img => typeof img === 'string' && img.trim() !== '');
          log(`additionalImages уже является массивом для ${platform}, содержит ${updatedContent.additionalImages.length} элементов после фильтрации`, 'social-publishing');
        } 
        // В остальных случаях создаем пустой массив
        else {
          updatedContent.additionalImages = [];
          log(`additionalImages преобразован в пустой массив для ${platform} (неизвестный тип)`, 'social-publishing');
        }
      } else {
        // Если additionalImages отсутствует, инициализируем его пустым массивом
        updatedContent.additionalImages = [];
        log(`additionalImages инициализирован пустым массивом для ${platform} (поле отсутствовало)`, 'social-publishing');
      }
      
      return updatedContent;
    } catch (error) {
      log(`Ошибка при обработке поля additionalImages для ${platform}: ${error}`, 'social-publishing');
      // В случае ошибки возвращаем контент с пустым массивом additionalImages
      return {
        ...updatedContent,
        additionalImages: []
      };
    }
  }

  /**
   * Загружает изображения на Beget S3 для использования в социальных сетях
   * @param content Контент с изображениями для загрузки
   * @returns Контент с обновленными URLs изображений
   */
  protected async uploadImagesToImgur(content: CampaignContent): Promise<CampaignContent> {
    try {
      const updatedContent = { ...content } as any;
      
      // Обрабатываем основное изображение, если оно локальное
      if (updatedContent.imageUrl && !updatedContent.imageUrl.startsWith('http')) {
        log(`Загрузка основного изображения на S3: ${updatedContent.imageUrl}`, 'social-publishing');
        
        try {
          const filePath = updatedContent.imageUrl;
          if (fs.existsSync(filePath)) {
            const imageBuffer = fs.readFileSync(filePath);
            const s3Key = `images/social/${Date.now()}-${path.basename(filePath)}`;
            
            const uploadResult = await begetS3StorageAws.uploadFile({
              key: s3Key,
              fileData: imageBuffer,
              contentType: 'image/jpeg'
            });
            
            if (uploadResult.success && uploadResult.url) {
              log(`Основное изображение загружено на S3: ${uploadResult.url}`, 'social-publishing');
              updatedContent.imageUrl = uploadResult.url;
            }
          }
        } catch (uploadError) {
          log(`Ошибка загрузки основного изображения на S3: ${uploadError}`, 'social-publishing');
        }
      }
      
      // Обрабатываем дополнительные изображения
      if (updatedContent.additionalImages && Array.isArray(updatedContent.additionalImages) && updatedContent.additionalImages.length > 0) {
        const localImages = updatedContent.additionalImages.filter((img: string) => img && typeof img === 'string' && !img.startsWith('http'));
        
        if (localImages.length > 0) {
          log(`Загрузка ${localImages.length} локальных изображений на S3`, 'social-publishing');
          
          const uploadPromises = localImages.map(async (imagePath: string) => {
            try {
              if (fs.existsSync(imagePath)) {
                const imageBuffer = fs.readFileSync(imagePath);
                const s3Key = `images/social/${Date.now()}-${path.basename(imagePath)}`;
                
                const uploadResult = await begetS3StorageAws.uploadFile({
                  key: s3Key,
                  fileData: imageBuffer,
                  contentType: 'image/jpeg'
                });
                
                return uploadResult.success ? uploadResult.url : null;
              }
              return null;
            } catch (error) {
              log(`Ошибка загрузки ${imagePath}: ${error}`, 'social-publishing');
              return null;
            }
          });
          
          const uploadResults = await Promise.all(uploadPromises);
          
          const imageUrlMap = new Map<string, string>();
          localImages.forEach((oldPath: string, index: number) => {
            const result = uploadResults[index];
            if (result) {
              imageUrlMap.set(oldPath, result);
            }
          });
          
          updatedContent.additionalImages = updatedContent.additionalImages.map((img: string) => {
            if (img && typeof img === 'string' && !img.startsWith('http') && imageUrlMap.has(img)) {
              return imageUrlMap.get(img) as string;
            }
            return img;
          });
        }
      }
      
      return updatedContent;
    } catch (error) {
      log(`Ошибка при загрузке изображений: ${error}`, 'social-publishing');
      return content;
    }
  }

  /**
   * Получает базовый URL приложения без использования process.env
   * @returns Базовый URL приложения
   */
  protected getAppBaseUrl(): string {
    // Приоритет имеют явно указанные URL
    // Сначала проверяем наличие переменных окружения
    const { getN8nUrl } = require('../../utils/n8n-utils');
    const n8nUrl = getN8nUrl();
    if (n8nUrl) {
      return n8nUrl.endsWith('/') ? n8nUrl.slice(0, -1) : n8nUrl;
    }
    return null;
  }
  
  /**
   * Обновляет статус публикации контента в социальной сети с улучшенной поддержкой мультиплатформ
   * Гарантирует сохранение данных по всем платформам при обновлении статуса конкретной платформы
   * КРИТИЧЕСКИ ВАЖНО: сохраняет данные всех платформ при обновлении одной!
   * @param contentId ID контента 
   * @param platform Социальная платформа, которая обновляется
   * @param publicationResult Результат публикации (статус, URL, ошибки и т.д.)
   * @returns Обновленный объект контента или null в случае ошибки
   */
  public async updatePublicationStatus(
    contentId: string,
    platform: SocialPlatform,
    publicationResult: SocialPublication
  ): Promise<CampaignContent | null> {
    // Генерируем уникальный идентификатор операции для корреляции логов
    const operationId = `update_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    log(`[${operationId}] ➡️ НАЧАЛО ОБРАБОТКИ обновления статуса публикации для контента ${contentId}, платформа: ${platform}, статус: ${publicationResult.status}`, 'social-publishing');
    
    // Получаем URL Directus
    const directusUrl = process.env.DIRECTUS_URL;
    
    try {
      // 1. Получаем токен администратора
      log(`[${operationId}] 1. Получение токена администратора`, 'social-publishing');
      const systemToken = await this.getSystemToken();
      
      if (!systemToken) {
        log(`[${operationId}] ❌ ОШИБКА: Не удалось получить токен администратора`, 'social-publishing');
        return null;
      }
      
      // 2. Получаем самые актуальные данные контента из Directus через storage
      log(`[${operationId}] 2. Запрос актуальных данных контента из Directus: ${contentId}`, 'social-publishing');
      let currentItem = await storage.getCampaignContentById(contentId, systemToken);
      
      if (!currentItem) {
        log(`[${operationId}] ❌ ОШИБКА: Не удалось получить данные контента: ${contentId}`, 'social-publishing');
        return null;
      }
      
      log(`[${operationId}] 2. ✅ Успешно получены данные контента: ${contentId}`, 'social-publishing');
      
      // 3. Извлекаем текущие данные социальных платформ
      log(`[${operationId}] 3. Извлекаем и анализируем текущие данные социальных платформ`, 'social-publishing');
      
      // Создаем копию с четким типом для избежания проблем с null/undefined
      // ВАЖНО: Если данных нет или они некорректны, используем пустой объект
      let currentPlatforms = {};
      try {
        if (currentItem.socialPlatforms) {
          if (typeof currentItem.socialPlatforms === 'string') {
            // Если данные пришли в виде строки, парсим их
            currentPlatforms = JSON.parse(currentItem.socialPlatforms);
          } else if (typeof currentItem.socialPlatforms === 'object') {
            // Если данные пришли в виде объекта, создаем глубокую копию
            currentPlatforms = JSON.parse(JSON.stringify(currentItem.socialPlatforms));
          }
          
          // Если socialPlatforms представлено как массив, преобразуем его в объект
          if (Array.isArray(currentPlatforms)) {
            const newSocialPlatforms: Record<string, any> = {};
            for (const platformName of currentPlatforms) {
              newSocialPlatforms[platformName] = newSocialPlatforms[platformName] || { status: 'pending' };
            }
            currentPlatforms = newSocialPlatforms;
            log(`[${operationId}] 3. Преобразуем массив socialPlatforms в объект для контента ${contentId}`, 'social-publishing');
          }
        }
      } catch (parseError) {
        log(`[${operationId}] ⚠️ Предупреждение: ошибка при парсинге данных платформ, используем пустой объект: ${parseError}`, 'social-publishing');
        currentPlatforms = {};
      }
      
      // Дополнительная проверка, что у нас точно объект
      if (!currentPlatforms || typeof currentPlatforms !== 'object') {
        currentPlatforms = {};
      }
      
      // Логируем текущее состояние платформ до обновления
      log(`[${operationId}] 3. Текущие данные платформ до обновления:\n${JSON.stringify(currentPlatforms, null, 2)}`, 'social-publishing');
      
      // ВАЖНО: Явно перечисляем все платформы, которые есть в данных до обновления
      const existingPlatforms = Object.keys(currentPlatforms);
      log(`[${operationId}] 3. ✅ Найдены существующие платформы (${existingPlatforms.length}): ${existingPlatforms.join(', ')}`, 'social-publishing');
      
      // 4. Подготовка обновленных данных для указанной платформы
      log(`[${operationId}] 4. Подготовка обновленных данных для платформы: ${platform}`, 'social-publishing');
      
      // Сохраняем данные текущей платформы, если они уже есть
      const existingPlatformData = currentPlatforms[platform] || {};
      
      const platformUpdateData = {
        // Сохраняем существующие данные для этой платформы
        ...existingPlatformData,
        // Обновляем статус и связанные поля
        status: publicationResult.status,
        publishedAt: publicationResult.publishedAt
          ? new Date(publicationResult.publishedAt).toISOString()
          : (publicationResult.status === 'published' ? new Date().toISOString() : null),
        error: publicationResult.error || null,
        // Добавляем новые данные из publicationResult при их наличии
        ...(publicationResult.postUrl ? { postUrl: publicationResult.postUrl } : {}),
        ...(publicationResult.postId ? { postId: publicationResult.postId } : {}),
        ...(publicationResult.messageId ? { messageId: publicationResult.messageId } : {})
      };
      
      log(`[${operationId}] 4. Подготовленные данные для платформы ${platform}:\n${JSON.stringify(platformUpdateData, null, 2)}`, 'social-publishing');
      
      // 5. Формирование финального объекта данных для всех платформ
      log(`[${operationId}] 5. Формирование финального объекта данных для всех платформ`, 'social-publishing');
      
      // Создаем новый объект, чтобы избежать мутаций
      const mergedPlatforms = { ...currentPlatforms };
      
      // Обновляем только данные для указанной платформы
      mergedPlatforms[platform] = platformUpdateData;
      
      // КРИТИЧЕСКАЯ ПРОВЕРКА: убедимся, что мы НЕ потеряли ни одну платформу
      const updatedPlatforms = Object.keys(mergedPlatforms);
      
      log(`[${operationId}] 5. ⚠️ ПРОВЕРКА СОХРАННОСТИ ДАННЫХ:`, 'social-publishing');
      log(`[${operationId}] 5. - До: ${existingPlatforms.length} платформ: ${existingPlatforms.join(', ')}`, 'social-publishing');
      log(`[${operationId}] 5. - После: ${updatedPlatforms.length} платформ: ${updatedPlatforms.join(', ')}`, 'social-publishing');
      
      if (existingPlatforms.length > updatedPlatforms.length) {
        log(`[${operationId}] 5. ❌ КРИТИЧЕСКАЯ ОШИБКА: потеряны данные платформ!`, 'social-publishing');
        
        // Восстанавливаем потерянные платформы
        for (const lostPlatform of existingPlatforms) {
          if (!mergedPlatforms[lostPlatform]) {
            log(`[${operationId}] 5. ⚠️ Восстанавливаем потерянную платформу: ${lostPlatform}`, 'social-publishing');
            mergedPlatforms[lostPlatform] = currentPlatforms[lostPlatform];
          }
        }
        
        // Повторная проверка после восстановления
        const restoredPlatforms = Object.keys(mergedPlatforms);
        log(`[${operationId}] 5. - После восстановления: ${restoredPlatforms.length} платформ: ${restoredPlatforms.join(', ')}`, 'social-publishing');
      }
      
      log(`[${operationId}] 5. ✅ Финальный объект данных для всех платформ:\n${JSON.stringify(mergedPlatforms, null, 2)}`, 'social-publishing');
      
      // 6. Отправка обновления в Directus через PATCH запрос через storage
      log(`[${operationId}] 6. Отправка обновления в Directus для контента: ${contentId}`, 'social-publishing');
      
      const updatePayload = { 
        // Обновляем только socialPlatforms
        socialPlatforms: mergedPlatforms,
        // Если публикация успешна, возможно, нужно обновить общий статус до "published"
        // только если мы публиковали на все выбранные платформы
        ...(publicationResult.status === 'published' ? {
          // Проверяем, были ли опубликованы все выбранные платформы
          status: this.shouldUpdateToPublished(currentItem, mergedPlatforms) ? 'published' : currentItem.status
        } : {})
      };
      
      log(`[${operationId}] 6. Запрос на обновление: ${JSON.stringify(updatePayload, null, 2)}`, 'social-publishing');
      
      try {
        // Обновляем контент через storage
        const updatedContent = await storage.updateCampaignContent(contentId, updatePayload, systemToken);
        
        if (!updatedContent) {
          throw new Error('Некорректный ответ API при обновлении');
        }
        
        log(`[${operationId}] 6. ✅ Обновление успешно отправлено в Directus`, 'social-publishing');
        
        // 7. Верификация обновления - проверим, что данные действительно обновились
        log(`[${operationId}] 7. Верификация обновления в Directus`, 'social-publishing');
        
        const verifiedContent = await storage.getCampaignContentById(contentId, systemToken);
        
        if (verifiedContent?.socialPlatforms) {
          const verifiedPlatforms = verifiedContent.socialPlatforms;
          const verifiedKeys = Object.keys(verifiedPlatforms);
          
          log(`[${operationId}] 7. Верификация платформ: ${verifiedKeys.length} платформ после обновления: ${verifiedKeys.join(', ')}`, 'social-publishing');
          
          if (verifiedKeys.length < updatedPlatforms.length) {
            log(`[${operationId}] 7. ⚠️ ПРЕДУПРЕЖДЕНИЕ: В Directus меньше платформ (${verifiedKeys.length}), чем мы отправили (${updatedPlatforms.length})`, 'social-publishing');
          } else {
            log(`[${operationId}] 7. ✅ Верификация успешна - все платформы сохранены`, 'social-publishing');
          }
        }
        
        log(`[${operationId}] ✅ ЗАВЕРШЕНО обновление статуса публикации для ${contentId}, платформа: ${platform}`, 'social-publishing');
        return updatedContent;
        
      } catch (updateError: any) {
        log(`[${operationId}] ❌ ОШИБКА при отправке обновления: ${updateError.message}`, 'social-publishing');
        
        // В случае ошибки возвращаем объект с текущими данными, но обновленными данными платформы
        // Это позволит клиенту видеть хотя бы частично обновленное состояние
        log(`[${operationId}] ⚠️ Возвращаем объект с локально обновленными данными платформы ${platform} (без сохранения в Directus)`, 'social-publishing');
        
        return {
          ...currentItem,
          // Используем объединенные данные платформ
          socialPlatforms: mergedPlatforms
        };
      }
      
    } catch (error: any) {
      log(`[${operationId}] ❌ КРИТИЧЕСКАЯ ОШИБКА при обновлении статуса публикации: ${error.message}`, 'social-publishing');
      return null;
    }
  }
  
  /**
   * Проверяет, следует ли обновить общий статус контента до "published"
   * @param content Оригинальный контент
   * @param socialPublications Обновленные статусы публикаций
   * @returns true ТОЛЬКО если ВСЕ выбранные платформы успешно опубликованы
   */
  private shouldUpdateToPublished(
    content: CampaignContent, 
    socialPublications: Record<string, any>
  ): boolean {
    // ВАЖНО: НИКОГДА не обновлять общий статус на "published" в этом методе
    // Для одиночного обновления платформы - возвращаем false, чтобы планировщик
    // самостоятельно принимал решение на основе всех платформ
    
    log(`🛑 ПРИНУДИТЕЛЬНОЕ ОТКЛЮЧЕНИЕ автоматического обновления общего статуса в updatePublicationStatus`, 'social-publishing');
    log(`👉 Передаем ответственность за обновление общего статуса планировщику публикаций`, 'social-publishing');
    
    // Всегда возвращаем false, чтобы не менять общий статус здесь
    return false;
    
    /* Старая логика закомментирована
    // Проверяем, указаны ли социальные платформы
    let selectedPlatforms: string[] = [];
      
    // Обрабатываем разные форматы поля socialPlatforms
    if (Array.isArray(content.socialPlatforms)) {
      // Если это массив строк, используем его напрямую
      selectedPlatforms = content.socialPlatforms;
    } else if (typeof content.socialPlatforms === 'object' && content.socialPlatforms !== null) {
      // Если это объект, извлекаем ключи
      selectedPlatforms = Object.keys(content.socialPlatforms);
    }
    
    if (!selectedPlatforms.length) {
      log(`У контента ${content.id} нет выбранных социальных платформ`, 'social-publishing');
      return false;
    }
    
    log(`Найдены платформы для проверки публикации: ${selectedPlatforms.join(', ')}`, 'social-publishing');
    
    // Проверяем, все ли выбранные платформы опубликованы
    let allPublished = true;
    
    for (const platform of selectedPlatforms) {
      // Если платформа выбрана, но не опубликована или публикация не прошла успешно
      if (
        !socialPublications[platform] || 
        socialPublications[platform].status !== 'published'
      ) {
        allPublished = false;
        log(`Платформа ${platform} не опубликована или публикация не прошла успешно`, 'social-publishing');
        break;
      }
    }
    
    log(`Проверка статуса публикации для ${content.id}: ${allPublished ? 'все платформы опубликованы' : 'не все платформы опубликованы'}`, 'social-publishing');
    return allPublished;
    */
  }

  /**
   * Публикует контент в выбранную социальную платформу
   * @param content Контент для публикации
   * @param platform Социальная платформа
   * @param settings Настройки социальных сетей
   * @returns Результат публикации
   */
  public abstract publishToPlatform(
    content: CampaignContent,
    platform: SocialPlatform,
    settings: SocialMediaSettings
  ): Promise<SocialPublication>;
}