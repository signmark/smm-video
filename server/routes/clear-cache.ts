import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Очистка всех кэшированных токенов и принудительное обновление
 */
router.post('/clear-cache', async (req: Request, res: Response) => {
  try {
    console.log('[clear-cache] Начинаем очистку кэшированных токенов');
    
    // Динамически импортируем сервисы для очистки кэша
    const { publishScheduler } = await import('../services/publish-scheduler');
    const { publicationStatusChecker } = await import('../services/status-checker');
    
    let clearedServices = [];
    
    // Очищаем кэш в publish-scheduler
    if (publishScheduler && typeof publishScheduler.clearTokenCache === 'function') {
      publishScheduler.clearTokenCache();
      clearedServices.push('publish-scheduler');
      console.log('[clear-cache] Кэш токенов очищен в publish-scheduler');
    }
    
    // Очищаем кэш в status-checker
    if (publicationStatusChecker && typeof publicationStatusChecker.clearTokenCache === 'function') {
      publicationStatusChecker.clearTokenCache();
      clearedServices.push('status-checker');
      console.log('[clear-cache] Кэш токенов очищен в status-checker');
    }
    
    // Очищаем кэш в storage
    try {
      const { storage } = await import('../storage');
      if (storage && typeof (storage as any).clearTokenCache === 'function') {
        (storage as any).clearTokenCache();
        clearedServices.push('storage');
        console.log('[clear-cache] Кэш токенов очищен в storage');
      }
    } catch (storageError) {
      console.log('[clear-cache] Storage не имеет метода clearTokenCache');
    }
    
    console.log(`[clear-cache] Кэш очищен в сервисах: ${clearedServices.join(', ')}`);
    
    res.json({
      success: true,
      message: 'Кэш токенов успешно очищен',
      clearedServices,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('[clear-cache] Ошибка при очистке кэша:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка при очистке кэша токенов',
      message: error.message
    });
  }
});

export default router;