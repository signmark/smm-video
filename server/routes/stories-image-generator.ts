import express from 'express';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Генератор изображений для Stories (клиентская генерация)
router.post('/generate-image', authMiddleware, async (req, res) => {
  try {
    const { storyId, textOverlays, backgroundImageUrl, title } = req.body;
    
    console.log('[STORIES-IMAGE-GENERATOR] Генерация изображения для Story:', storyId);
    
    // Возвращаем данные для клиентской генерации
    res.json({
      success: true,
      message: 'Используйте клиентский генератор',
      data: {
        storyId,
        textOverlays,
        backgroundImageUrl,
        title,
        width: 1080,
        height: 1920,
        format: 'png'
      }
    });
    
  } catch (error) {
    console.error('[STORIES-IMAGE-GENERATOR] Ошибка генерации изображения:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка генерации изображения',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

// Генерация изображения по ID Stories
router.get('/generate/:storyId', authMiddleware, async (req, res) => {
  try {
    const { storyId } = req.params;
    
    // Здесь нужно получить данные Stories из базы данных
    // Пока используем заглушку, потом подключим к реальной базе
    
    console.log('[STORIES-IMAGE-GENERATOR] Генерация изображения для Stories ID:', storyId);
    
    res.json({
      success: false,
      error: 'Функция в разработке',
      message: 'Используйте POST /generate-image с данными Stories'
    });
    
  } catch (error) {
    console.error('[STORIES-IMAGE-GENERATOR] Ошибка:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

export default router;