/**
 * Универсальный вебхук для обновления статуса публикации в социальных сетях
 * Этот вебхук надежно обновляет только ту часть socialPlatforms, которая относится
 * к конкретной платформе, сохраняя информацию о других платформах
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import log from '../utils/logger';
import { DirectusAuthManager } from '../services/directus-auth-manager';

const router = Router();
const DIRECTUS_URL = process.env.DIRECTUS_URL;

// Генерация уникального ID для каждого запроса для отслеживания в логах
const generateRequestId = (): string => {
  return `status_update_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

/**
 * Получает текущие данные контента из Directus
 * @param contentId ID контента
 * @param token Токен авторизации Directus
 * @returns Данные контента или null
 */
async function getContentData(contentId: string, token: string): Promise<any> {
  try {
    const response = await axios.get(
      `${DIRECTUS_URL}/items/campaign_content/${contentId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    return response.data.data;
  } catch (error) {
    log.error(`Ошибка при получении данных контента ${contentId}: ${error.message}`);
    return null;
  }
}

/**
 * Обновляет статус публикации контента в Directus
 * @param contentId ID контента
 * @param updates Обновления для контента
 * @param token Токен авторизации Directus
 * @returns Успех операции
 */
async function updateContentStatus(contentId: string, updates: any, token: string): Promise<boolean> {
  try {
    // Добавляем подробное логирование обновления контента
    log.info(`Обновление статуса контента ${contentId}. Данные для обновления: ${JSON.stringify(updates)}`);
    
    // Получаем текущие данные контента для проверки всех платформ
    const contentData = await getContentData(contentId, token);
    if (!contentData) {
      log.error(`Не удалось получить текущие данные контента ${contentId} перед обновлением`);
      return false;
    }
    
    // Проверяем статусы всех платформ и решаем, нужно ли обновить общий статус
    const currentSocialPlatforms = contentData.social_platforms || {};
    
    // Выполняем обновление статуса платформы
    const response = await axios.patch(
      `${DIRECTUS_URL}/items/campaign_content/${contentId}`,
      updates,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    
    // После обновления проверяем, нужно ли обновить общий статус контента
    // Это дополнительная проверка для надежности
    // Получаем обновленные данные
    const updatedContentData = await getContentData(contentId, token);
    if (updatedContentData && updatedContentData.social_platforms) {
      const updatedPlatforms = updatedContentData.social_platforms;
      
      // Получаем списки платформ по их статусам
      // ВАЖНО: Все платформы из JSON считаются выбранными
      const selectedPlatforms = Object.keys(updatedPlatforms);
      const publishedPlatforms = [];
      const pendingPlatforms = [];
      const failedPlatforms = [];
      
      // Проходим по всем платформам из JSON
      for (const [platform, data] of Object.entries(updatedPlatforms)) {
        if (data.status === 'published') {
          publishedPlatforms.push(platform);
        } else if (data.status === 'pending' || data.status === 'scheduled') {
          pendingPlatforms.push(platform);
        } else if (data.status === 'failed' || data.status === 'error') {
          failedPlatforms.push(platform);
        }
      }
      
      // Проверяем условия для обновления статуса
      const allSelectedPublished = selectedPlatforms.length === publishedPlatforms.length && selectedPlatforms.length > 0;
      const hasErrors = failedPlatforms.length > 0;
      const hasPending = pendingPlatforms.length > 0;
      
      log.info(`Анализ статусов платформ для контента ${contentId}:`);
      log.info(`  - Выбрано: ${selectedPlatforms.length} платформ: ${selectedPlatforms.join(', ')}`);
      log.info(`  - Опубликовано: ${publishedPlatforms.length} платформ: ${publishedPlatforms.join(', ')}`);
      log.info(`  - В ожидании: ${pendingPlatforms.length} платформ: ${pendingPlatforms.join(', ')}`);
      log.info(`  - С ошибками: ${failedPlatforms.length} платформ: ${failedPlatforms.join(', ')}`);
      
      // Обновляем статус на "published" ТОЛЬКО если ВСЕ выбранные платформы опубликованы
      if (allSelectedPublished && !hasErrors && !hasPending && updatedContentData.status !== 'published') {
        log.info(`Все выбранные платформы опубликованы, обновляем общий статус контента на 'published'`);
        
        // Обновляем общий статус контента
        try {
          await axios.patch(
            `${DIRECTUS_URL}/items/campaign_content/${contentId}`,
            { status: 'published', publishedAt: new Date() },
            {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          );
          log.info(`Статус контента ${contentId} успешно обновлен на 'published'`);
        } catch (updateError) {
          log.error(`Ошибка при обновлении общего статуса контента ${contentId}: ${updateError.message}`);
        }
      } else if (allSelectedPublished && hasErrors && !hasPending) {
        // Если все выбранные платформы обработаны, но есть ошибки - статус остается как есть
        log.info(`Все выбранные платформы обработаны, но есть ошибки. Статус контента ${contentId} остается без изменений`);
      } else if (hasPending) {
        // Если есть платформы в ожидании - не меняем статус
        log.info(`Есть платформы в ожидании для контента ${contentId}. Статус остается без изменений`);
      } else {
        log.info(`Условия для обновления статуса контента ${contentId} не выполнены: allSelected=${allSelectedPublished}, hasErrors=${hasErrors}, hasPending=${hasPending}, currentStatus=${updatedContentData.status}`);
      }
    }
    
    return true;
  } catch (error) {
    log.error(`Ошибка при обновлении статуса контента ${contentId}: ${error.message}`);
    return false;
  }
}

/**
 * Проверяет наличие ключей платформ в social_platforms и возвращает массив их имен
 * @param socialPlatforms Объект с данными платформ
 * @returns Массив имен найденных платформ
 */
function getPlatformNames(socialPlatforms: any): string[] {
  if (!socialPlatforms || typeof socialPlatforms !== 'object') {
    return [];
  }
  return Object.keys(socialPlatforms);
}

// Универсальный вебхук для обновления статуса публикации в любой социальной сети
router.post('/update-status/:platform', async (req: Request, res: Response) => {
  const requestId = generateRequestId();
  const { platform } = req.params;
  const { contentId, status, postUrl, postId, publishedAt, error } = req.body;

  log.info(`[${requestId}] Получен запрос на обновление статуса ${platform} для контента ${contentId}`);
  log.info(`[${requestId}] Данные обновления: ${JSON.stringify({ status, postUrl, postId, publishedAt, error })}`);

  if (!contentId) {
    log.error(`[${requestId}] Не указан ID контента`);
    return res.status(400).json({ error: 'Не указан ID контента' });
  }

  if (!platform) {
    log.error(`[${requestId}] Не указана платформа`);
    return res.status(400).json({ error: 'Не указана платформа' });
  }

  try {
    // Получаем токен администратора из DirectusAuthManager
    const adminToken = DirectusAuthManager.getAdminToken();
    
    if (!adminToken) {
      log.error(`[${requestId}] Не найден токен администратора. Используем токен из запроса.`);
    }
    
    // Используем токен администратора или токен из запроса
    const token = adminToken || req.body.token;
    
    if (!token) {
      log.error(`[${requestId}] Нет доступного токена авторизации`);
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    // 1. Получаем текущие данные контента
    log.info(`[${requestId}] Получение текущих данных контента ${contentId}`);
    const contentData = await getContentData(contentId, token);
    
    if (!contentData) {
      log.error(`[${requestId}] Не удалось получить данные контента ${contentId}`);
      return res.status(404).json({ error: 'Контент не найден' });
    }

    // 2. Получаем текущие данные социальных платформ
    const currentSocialPlatforms = contentData.social_platforms || {};
    log.info(`[${requestId}] Текущие платформы: ${getPlatformNames(currentSocialPlatforms).join(', ')}`);

    // 3. Создаем глубокую копию текущих данных социальных платформ
    const updatedSocialPlatforms = JSON.parse(JSON.stringify(currentSocialPlatforms));
    
    // 4. Обновляем данные только для указанной платформы
    updatedSocialPlatforms[platform] = {
      ...updatedSocialPlatforms[platform], // сохраняем существующие данные платформы
      status: status || updatedSocialPlatforms[platform]?.status,
      postUrl: postUrl || updatedSocialPlatforms[platform]?.postUrl,
      postId: postId || updatedSocialPlatforms[platform]?.postId,
      publishedAt: publishedAt || updatedSocialPlatforms[platform]?.publishedAt,
      error: error || updatedSocialPlatforms[platform]?.error,
      platform // всегда добавляем имя платформы
    };
    
    // Особая обработка для статуса error
    if (status === 'error' && error) {
      updatedSocialPlatforms[platform].error = error;
    }
    
    // Особая обработка для статуса published
    if (status === 'published') {
      updatedSocialPlatforms[platform].error = null; // Сбрасываем ошибку при успешной публикации
    }

    // 5. Подготавливаем данные для обновления
    const updates = {
      social_platforms: updatedSocialPlatforms
    };
    
    // Если все платформы опубликованы, обновляем общий статус
    
    // Разделяем все платформы и их статусы
    const platformsArray = []; // Все платформы в JSON
    const publishedPlatforms = [];
    const pendingPlatforms = [];
    const errorPlatforms = [];
    
    // Флаг для проверки pending статуса в любой платформе
    let hasPendingStatusAnyPlatform = false;
    
    // ВАЖНО: Все платформы в JSON должны обрабатываться независимо от флага selected
    // Все платформы, указанные в JSON - значит их надо обрабатывать
    
    // Проходим по всем платформам и собираем статистику
    for (const [platform, data] of Object.entries(updatedSocialPlatforms)) {
      // Все платформы заносим в общий список
      platformsArray.push(platform);
      
      if (data.status === 'published' && data.postUrl) {
        publishedPlatforms.push(platform);
      } else if (data.status === 'pending' || data.status === 'scheduled' || 
                 (data.status === 'published' && !data.postUrl)) {
        pendingPlatforms.push(platform);
        hasPendingStatusAnyPlatform = true;
        const reason = data.status === 'published' && !data.postUrl ? 
          `статус 'published' но отсутствует postUrl` : 
          `статус '${data.status}'`;
        log.info(`[ОтЛАДКА] Обнаружена платформа ${platform} в ${reason}, блокируем обновление до published`);
      } else if (data.status === 'failed' || data.status === 'error') {
        errorPlatforms.push(platform);
      }
    }
    
    // Проверяем, что ВСЕ платформы в JSON опубликованы
    // ВАЖНО: Проверять все платформы, а не только с selected: true
    const allPlatformsPublished = platformsArray.length === publishedPlatforms.length && platformsArray.length > 0;
    const hasErrors = errorPlatforms.length > 0;
    const hasPending = pendingPlatforms.length > 0;
    
    // Детальное логирование для анализа проблемы с Facebook
    log.info(`[ОтЛАДКА] Статусы платформ: Всего=${platformsArray.length}, Опубликовано=${publishedPlatforms.length}, Ошибки=${errorPlatforms.length}, Ожидают=${pendingPlatforms.length}`);
    log.info(`[ОтЛАДКА] Список всех платформ: ${platformsArray.join(', ')}`);
    log.info(`[ОтЛАДКА] Список опубликованных платформ: ${publishedPlatforms.join(', ')}`);
    log.info(`[ОтЛАДКА] allPlatformsPublished = ${allPlatformsPublished}`);
    
    // Обновляем общий статус только если:
    // 1) ВСЕ платформы в JSON опубликованы - независимо от флага selected
    // 2) И нет платформ в статусе pending или scheduled
    if (allPlatformsPublished && platformsArray.length > 0 && !hasPendingStatusAnyPlatform) {
      log.info(`ВСЕ платформы опубликованы (${publishedPlatforms.length}/${platformsArray.length}), присваиваем статус published`);
      updates['status'] = 'published';
      updates['published_at'] = new Date().toISOString();
      
      // Дополнительно повторно подтверждаем сброс всех статусов ошибок в платформах
      for (const key of Object.keys(updatedSocialPlatforms)) {
        if (updatedSocialPlatforms[key].selected === true) {
          updatedSocialPlatforms[key].error = null;
        }
      }
      
    } else if (hasErrors && !hasPending) {
      log.info(`Есть ошибки и нет ожидающих платформ, присваиваем статус failed`);
      updates['status'] = 'failed';
    } else if (publishedPlatforms.length > 0 && publishedPlatforms.length < platformsArray.length) {
      // Часть платформ опубликована, но не все - устанавливаем статус scheduled
      log.info(`Опубликовано только ${publishedPlatforms.length}/${platformsArray.length} платформ, статус не меняем или устанавливаем scheduled`);
      // Получаем текущий статус контента
      const currentStatus = contentData?.status || '';
      // Если статус draft, меняем на scheduled
      if (currentStatus === 'draft') {
        updates['status'] = 'scheduled';
      }
      // Иначе оставляем текущий статус
    }

    log.info(`[${requestId}] Платформы после обновления: ${getPlatformNames(updatedSocialPlatforms).join(', ')}`);
    log.info(`[${requestId}] Итоговые данные platform -> status:`);
    for (const [plt, data] of Object.entries(updatedSocialPlatforms)) {
      const hasUrl = (data as any).postUrl ? '(имеет URL)' : '(без URL)';
      log.info(`[${requestId}]   - ${plt}: ${(data as any).status} ${hasUrl}`);
    }

    // 6. Отправляем обновление в Directus
    log.info(`[${requestId}] Отправка обновленных данных в Directus`);
    const updateSuccess = await updateContentStatus(contentId, updates, token);
    
    if (!updateSuccess) {
      log.error(`[${requestId}] Ошибка при обновлении статуса контента ${contentId}`);
      return res.status(500).json({ error: 'Ошибка при обновлении статуса' });
    }

    // 7. Проверяем, что обновление прошло успешно
    log.info(`[${requestId}] Верификация обновления в Directus`);
    const updatedContent = await getContentData(contentId, token);
    
    if (!updatedContent) {
      log.error(`[${requestId}] Не удалось получить обновленные данные контента ${contentId}`);
      return res.status(500).json({ 
        error: 'Не удалось верифицировать обновление',
        success: true // все равно возвращаем успех, т.к. обновление могло пройти успешно
      });
    }
    
    const updatedPlatforms = getPlatformNames(updatedContent.social_platforms);
    log.info(`[${requestId}] Верификация платформ: ${updatedPlatforms.length} платформ после обновления: ${updatedPlatforms.join(', ')}`);
    
    // Проверяем, что все платформы сохранились
    const originalPlatforms = getPlatformNames(currentSocialPlatforms);
    const allPlatformsPreserved = originalPlatforms.every(p => updatedPlatforms.includes(p));
    
    if (!allPlatformsPreserved) {
      log.warn(`[${requestId}] ВНИМАНИЕ: Не все платформы сохранены после обновления!`);
      log.warn(`[${requestId}] Было: ${originalPlatforms.join(', ')}, стало: ${updatedPlatforms.join(', ')}`);
    } else {
      log.info(`[${requestId}] ✅ Верификация успешна - все платформы сохранены`);
    }

    log.info(`[${requestId}] ✅ ЗАВЕРШЕНО обновление статуса публикации для ${contentId}, платформа: ${platform}`);
    
    return res.json({
      success: true,
      message: `Статус публикации в ${platform} успешно обновлен`,
      contentId,
      platform,
      status: updatedSocialPlatforms[platform].status,
      allPlatformsPreserved
    });
  } catch (error) {
    log.error(`[${requestId}] Критическая ошибка при обновлении статуса: ${error.message}`);
    log.error(error.stack);
    
    return res.status(500).json({
      error: `Ошибка при обновлении статуса: ${error.message}`,
      success: false
    });
  }
});

export default router;