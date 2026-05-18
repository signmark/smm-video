import express from 'express';
import { GlobalApiKeysService } from '../services/global-api-keys.js';

const router = express.Router();

// Получение информации о YouTube канале по access token
router.get('/youtube/channel-info', async (req, res) => {
  try {
    const { accessToken } = req.query;
    
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Access token is required'
      });
    }

    // Очищаем токен от пробелов и других невалидных символов
    const cleanToken = accessToken.toString().trim().replace(/\s+/g, '');

    // Запрашиваем информацию о канале через YouTube Data API v3
    // Для запросов с mine=true используем только OAuth токен без API ключа
    // API ключ и OAuth токен должны быть из одного проекта Google Cloud
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true`,
      {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    if (!channelResponse.ok) {
      const errorData = await channelResponse.text();
      return res.status(channelResponse.status).json({
        success: false,
        error: `YouTube API error: ${channelResponse.statusText}`,
        details: errorData
      });
    }

    const channelData = await channelResponse.json();

    if (!channelData.items || channelData.items.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'У вас нет YouTube канала. Создайте канал в YouTube Studio, затем повторите авторизацию.',
        errorCode: 'NO_CHANNEL',
        details: 'Аккаунт Google авторизован, но не найден связанный YouTube канал'
      });
    }

    const channel = channelData.items[0];
    const channelInfo = {
      channelId: channel.id,
      channelTitle: channel.snippet.title,
      channelDescription: channel.snippet.description,
      thumbnails: channel.snippet.thumbnails,
      subscriberCount: channel.statistics.subscriberCount,
      viewCount: channel.statistics.viewCount,
      videoCount: channel.statistics.videoCount,
      publishedAt: channel.snippet.publishedAt
    };



    res.json({
      success: true,
      channelInfo
    });

  } catch (error) {
    console.error('❌ [YOUTUBE-CHANNEL] Error getting channel info:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;