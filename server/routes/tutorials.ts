/**
 * API маршруты для управления видео-инструкциями
 * Updated: 2025-10-20 - Fixed to use req.user.token directly
 */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware, authenticatedMiddleware } from '../middleware/admin';
import { directusCrud } from '../services/directus-crud';
import { z } from 'zod';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Настройка multer для обработки загрузки файлов
const upload = multer({
  storage: multer.memoryStorage(), // Храним в памяти для прямой загрузки в S3
  limits: {
    fileSize: 500 * 1024 * 1024, // максимум 500MB
  },
  fileFilter: (req, file, cb) => {
    // Проверяем расширение файла, игнорируя неправильный MIME тип от браузера
    // Принимаем только MP4 и WEBM - основные веб-форматы
    const filename = file.originalname.toLowerCase();
    const hasValidExtension = filename.endsWith('.mp4') || filename.endsWith('.webm');
    
    if (hasValidExtension) {
      console.log(`[UPLOAD] Accepting file: ${file.originalname} (reported MIME: ${file.mimetype})`);
      cb(null, true);
    } else {
      console.log(`[UPLOAD] Rejecting file: ${file.originalname} (invalid extension)`);
      cb(new Error(`Invalid file type. Only MP4 and WEBM video files are allowed.`));
    }
  },
});

/**
 * POST /api/tutorials/upload
 * Простая загрузка видео через backend (без CORS проблем)
 * Требует: авторизация
 */
router.post('/upload', authMiddleware, authenticatedMiddleware, upload.single('video'), async (req: Request, res: Response) => {
  console.log('=== TUTORIAL UPLOAD ENDPOINT REACHED ===');
  console.log('File received:', req.file ? 'YES' : 'NO');
  
  try {
    console.log('File info:', req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'NO FILE');
    console.log('Body received:', JSON.stringify(req.body));

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided'
      });
    }

    const { title, description, category } = req.body;

    if (!title || !category) {
      return res.status(400).json({
        success: false,
        error: 'Title and category are required'
      });
    }

    // Определяем правильный MIME тип на основе имени файла
    const filename = req.file.originalname.toLowerCase();
    let correctMimeType = req.file.mimetype;
    let fileExtension = '.webm'; // fallback
    
    if (filename.endsWith('.mp4') || req.file.mimetype.startsWith('video/mp4')) {
      correctMimeType = 'video/mp4';
      fileExtension = '.mp4';
    } else if (filename.endsWith('.webm') || req.file.mimetype.startsWith('video/webm')) {
      correctMimeType = 'video/webm';
      fileExtension = '.webm';
    }
    
    console.log('MIME type correction:', {
      original: req.file.mimetype,
      corrected: correctMimeType,
      filename: req.file.originalname,
      extension: fileExtension
    });

    // Генерируем уникальное имя файла
    const fileKey = `tutorials/${uuidv4()}${fileExtension}`;
    console.log('Generated file key:', fileKey);

    // Используем существующий Beget S3 service
    console.log('Importing Beget S3 service...');
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    console.log('Beget S3 service imported successfully');
    
    // Загружаем файл через beget service с правильным MIME типом
    console.log('Starting S3 upload...');
    let uploadResult;
    try {
      uploadResult = await begetS3StorageAws.uploadFile({
        key: fileKey,
        fileData: req.file.buffer,
        contentType: correctMimeType
      });
      console.log('S3 upload result:', uploadResult);
    } catch (s3Error) {
      console.error('S3 upload error:', s3Error);
      return res.status(500).json({
        success: false,
        error: 'S3 upload failed: ' + (s3Error instanceof Error ? s3Error.message : 'Unknown S3 error')
      });
    }

    if (!uploadResult.success) {
      console.error('S3 upload failed:', uploadResult.error);
      return res.status(500).json({
        success: false,
        error: uploadResult.error || 'Failed to upload to S3'
      });
    }

    console.log('S3 upload successful!');

    // Проверяем что пользователь аутентифицирован
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    // Сохраняем метаданные в Directus
    const tutorialData = {
      tutorial_id: `tutorial-${Date.now()}`,
      title,
      description: description || '',
      category,
      video_path: fileKey,
      uploaded_by: req.user.id
    };

    console.log('About to save tutorial to Directus:', {
      tutorialData,
      userId: req.user?.id
    });

    let tutorial;
    try {
      console.log('Creating tutorial in Directus with data:', JSON.stringify(tutorialData, null, 2));
      
      // Используем USER TOKEN из req.user (frontend обновляет автоматически)
      const userToken = req.user?.token;
      if (!userToken) {
        return res.status(401).json({
          success: false,
          error: 'User token not found'
        });
      }
      
      tutorial = await directusCrud.create('video_tutorials', tutorialData, {
        authToken: userToken
      });

      console.log('Tutorial saved successfully to Directus:', tutorial);
    } catch (directusError) {
      console.error('=== DIRECTUS ERROR DETAILS ===');
      console.error('Error object:', directusError);
      console.error('Error message:', directusError instanceof Error ? directusError.message : 'Unknown');
      console.error('Error stack:', directusError instanceof Error ? directusError.stack : 'N/A');
      console.error('Tutorial data that failed:', JSON.stringify(tutorialData, null, 2));
      
      // Возвращаем детальную ошибку клиенту
      return res.status(500).json({
        success: false,
        error: 'Database error',
        details: directusError instanceof Error ? directusError.message : 'Unknown database error'
      });
    }

    return res.status(201).json({
      success: true,
      data: tutorial
    });

  } catch (error) {
    console.error('=== TUTORIAL UPLOAD ERROR ===');
    console.error('Error object:', error);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown');
    console.error('Error stack:', error instanceof Error ? error.stack : 'N/A');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Error uploading video'
    });
  }
});


/**
 * GET /api/tutorials
 * Получить список всех видео-инструкций из Directus
 * Требует: авторизация (USER TOKEN)
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[TUTORIALS GET] Request received');
    const userToken = req.user?.token;
    
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'User token not found'
      });
    }
    
    const tutorials = await directusCrud.list('video_tutorials', {
      sort: ['-created_at'],
      authToken: userToken
      // Не указываем fields - пусть Directus вернёт все доступные поля
    });
    
    console.log('[TUTORIALS GET] Returning', tutorials?.length || 0, 'tutorials');
    
    return res.json({
      success: true,
      data: tutorials || []
    });
  } catch (error: any) {
    console.error('[TUTORIALS GET] ERROR:', error);
    
    // Если ошибка 403 - у пользователя нет прав доступа, вернем пустой массив
    if (error?.response?.status === 403 || error?.status === 403) {
      console.log('[TUTORIALS GET] User has no access to tutorials (403), returning empty array');
      return res.json({
        success: true,
        data: [],
        message: 'No tutorials available for this user'
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Error fetching tutorials',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});


/**
 * GET /api/tutorials/:id/stream
 * Получить presigned URL для просмотра видео из S3
 * Требует: авторизация (USER TOKEN)
 */
router.get('/:id/stream', authMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[TUTORIALS STREAM] Request received for ID:', req.params.id);
    
    const tutorialId = req.params.id;
    const userToken = req.user?.token;
    
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'User token not found'
      });
    }

    // Загружаем все tutorials через list (используя USER TOKEN)
    const tutorials = await directusCrud.list('video_tutorials', {
      authToken: userToken
      // Не указываем fields - пусть Directus вернёт все доступные поля
    });
    
    // Находим нужный tutorial по ID
    const tutorial = tutorials.find((t: any) => t.id === tutorialId) as any;

    if (!tutorial) {
      return res.status(404).json({
        success: false,
        error: 'Tutorial not found'
      });
    }

    // Генерируем presigned URL для просмотра через Beget S3
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    const downloadUrl = await begetS3StorageAws.getSignedUrl(
      tutorial.video_path,
      3600 // 60 минут
    );

    console.log('[TUTORIALS STREAM] Success! Returning URL:', downloadUrl?.substring(0, 50) + '...');
    
    return res.json({
      success: true,
      data: {
        streamUrl: downloadUrl,
        tutorial: tutorial,
        expiresInMinutes: 60
      }
    });
  } catch (error) {
    console.error('[TUTORIALS STREAM] ERROR:', error);
    console.error('[TUTORIALS STREAM] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[TUTORIALS STREAM] Error stack:', error instanceof Error ? error.stack : 'N/A');
    
    return res.status(500).json({
      success: false,
      error: 'Error generating stream URL',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/tutorials/:id
 * Обновить видео-инструкцию в Directus
 * Требует: админские права
 */
router.put('/:id', (req, res, next) => {
  console.log('[TUTORIALS PUT] 🔥 RAW REQUEST RECEIVED - ID:', req.params.id, 'Method:', req.method);
  next();
}, authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[TUTORIALS PUT] ✅ AFTER MIDDLEWARE - Request received for ID:', req.params.id);
    const tutorialId = req.params.id;
    const { title, description, category } = req.body;

    // Проверяем обязательные поля
    if (!title || !category) {
      return res.status(400).json({
        success: false,
        error: 'Title and category are required'
      });
    }

    // Используем USER TOKEN из req.user (frontend обновляет автоматически)
    const userToken = req.user?.token;
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'User token not found'
      });
    }
    
    const updatedTutorial = await directusCrud.update('video_tutorials', tutorialId, {
      title,
      description: description || '',
      category
    }, {
      authToken: userToken
    });

    console.log('[TUTORIALS PUT] Tutorial updated successfully');

    return res.json({
      success: true,
      data: updatedTutorial
    });
  } catch (error) {
    console.error('[TUTORIALS PUT] ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Error updating tutorial',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * DELETE /api/tutorials/:id
 * Удалить видео-инструкцию из Directus (включая файл из S3)
 * Требует: админские права
 */
router.delete('/:id', (req, res, next) => {
  console.log('[TUTORIALS DELETE] 🔥 RAW REQUEST RECEIVED - ID:', req.params.id, 'Method:', req.method);
  next();
}, authMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[TUTORIALS DELETE] ✅ AFTER MIDDLEWARE - Request received for ID:', req.params.id);
    const tutorialId = req.params.id;

    // Проверяем админа напрямую через функцию
    const { isUserAdmin } = await import('../routes-global-api-keys');
    const isAdmin = await isUserAdmin(req);
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    // Используем USER TOKEN из req.user (frontend обновляет автоматически)
    const userToken = req.user?.token;
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'User token not found'
      });
    }
    
    const tutorials = await directusCrud.list('video_tutorials', {
      authToken: userToken
    });
    
    const tutorial = tutorials.find((t: any) => t.id === tutorialId) as any;

    if (!tutorial) {
      console.log('[TUTORIALS DELETE] Tutorial not found');
      return res.status(404).json({
        success: false,
        error: 'Tutorial not found'
      });
    }

    console.log('[TUTORIALS DELETE] Found tutorial, deleting from S3:', tutorial.video_path);

    // Удалить файл из S3
    const { begetS3StorageAws } = await import('../services/beget-s3-storage-aws');
    try {
      await begetS3StorageAws.deleteFile(tutorial.video_path);
      console.log('[TUTORIALS DELETE] File deleted from S3');
    } catch (s3Error) {
      console.error('[TUTORIALS DELETE] S3 delete error (continuing):', s3Error);
      // Продолжаем удаление записи из Directus даже если файл не удален
    }

    // Удалить запись из Directus используя USER TOKEN
    await directusCrud.delete('video_tutorials', tutorialId, {
      authToken: userToken
    });

    console.log('[TUTORIALS DELETE] Tutorial deleted successfully');

    return res.json({
      success: true,
      message: 'Tutorial deleted successfully'
    });
  } catch (error) {
    console.error('[TUTORIALS DELETE] ERROR:', error);
    return res.status(500).json({
      success: false,
      error: 'Error deleting tutorial',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;