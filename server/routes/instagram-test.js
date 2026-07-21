/**
 * Тестовые маршруты для Instagram публикации
 */

import express from 'express';
import InstagramDirectService from '../services/instagram-direct.js';
import { authenticateUser } from '../middleware/user-auth.js';

const router = express.Router();
const instagramService = new InstagramDirectService();

// Тестовый маршрут для проверки Instagram публикации
router.post('/test-instagram-publish', authenticateUser, async (req, res) => {
  console.log('🧪 Получен запрос на тест Instagram публикации');
  
  try {
    const {
      caption = '🚀 Тестовый пост из SMM Manager! #SMM #автоматизация #test',
      imageUrl = 'https://picsum.photos/1080/1080?random=1',
      username = process.env.INSTAGRAM_TEST_USERNAME,
      password = process.env.INSTAGRAM_TEST_PASSWORD
    } = req.body;

    if (!username || !password) {
      return res.status(503).json({
        success: false,
        code: 'INSTAGRAM_TEST_CREDENTIALS_MISSING',
        error: 'Тестовые учётные данные Instagram не настроены',
      });
    }
    
    console.log('📝 Данные для публикации:', {
      caption: caption.substring(0, 50) + '...',
      imageUrl,
      username
    });
    
    // Запускаем тест публикации
    const result = await instagramService.testPublish({
      caption,
      imageUrl,
      username,
      password
    });
    
    console.log('📊 Результат публикации:', result);
    
    res.json({
      success: true,
      message: 'Тест Instagram публикации выполнен',
      data: result
    });
    
  } catch (error) {
    console.error('❌ Ошибка тестового маршрута:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка при тестировании Instagram публикации'
    });
  }
});

// Маршрут для получения статуса Instagram сервиса
router.get('/instagram-status', async (req, res) => {
  console.log('📊 Проверка статуса Instagram сервиса');
  
  try {
    res.json({
      success: true,
      message: 'Instagram сервис готов к работе',
      data: {
        serviceActive: true,
        lastTest: new Date().toISOString(),
        features: [
          'Загрузка изображений',
          'Публикация постов',
          'Симуляция публикации (без реальных API ключей)'
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка проверки статуса:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка проверки статуса Instagram сервиса'
    });
  }
});

// Маршрут для симуляции webhook публикации
router.post('/webhook-simulate', authenticateUser, async (req, res) => {
  console.log('🔗 Симуляция webhook публикации Instagram');
  
  try {
    const {
      content,
      imageUrl,
      contentId,
      campaignId,
      settings
    } = req.body;
    
    console.log('📝 Данные webhook:', {
      contentId,
      campaignId,
      hasImage: !!imageUrl,
      hasSettings: !!settings
    });
    
    // Симулируем публикацию
    const result = await instagramService.publishToInstagram({
      caption: content,
      imageUrl,
      settings: settings || {
        username: process.env.INSTAGRAM_TEST_USERNAME,
        password: process.env.INSTAGRAM_TEST_PASSWORD
      }
    });
    
    console.log('📊 Результат webhook:', result);
    
    res.json({
      success: result.success,
      message: result.message,
      data: {
        postUrl: result.postUrl,
        publishedAt: result.publishedAt,
        platform: 'instagram'
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка webhook симуляции:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка симуляции webhook публикации'
    });
  }
});

export default router;
