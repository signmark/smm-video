import express from 'express';
import axios from 'axios';

const router = express.Router();

/**
 * Получение Facebook настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/facebook-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    // Используем системный токен как fallback для доступа к базе данных
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;
    
    if (!tokenToUse) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не доступен'
      });
    }

    // Получаем настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenToUse}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const socialMediaSettings = campaign.social_media_settings || {};
    const facebookSettings = socialMediaSettings.facebook || null;

    res.json({
      success: true,
      settings: facebookSettings
    });

  } catch (error: any) {
    console.error('❌ Error retrieving Facebook settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения настроек Facebook',
      details: error.message
    });
  }
});

/**
 * Сохранение Facebook настроек в JSON кампании
 */
router.post('/campaigns/:campaignId/facebook-settings', async (req, res) => {
  const { campaignId } = req.params;
  const { token, pageId, pageName, userToken: userAccessToken } = req.body;
  const authToken = req.headers.authorization?.replace('Bearer ', '');

  if (!authToken) {
    return res.status(401).json({
      success: false,
      error: 'Токен авторизации обязателен'
    });
  }

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Facebook токен обязателен'
    });
  }

  // Проверяем что токен не содержит лог консоли
  if (token.includes('Facebook Wizard:') || token.includes('%20') || token.includes('FacebookSetupWizard')) {
    return res.status(400).json({
      success: false,
      error: 'Получен некорректный токен Facebook'
    });
  }

  try {
    // Получаем текущие настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const existingSocialSettings = campaign.social_media_settings || {};
    const existingFacebook = existingSocialSettings.facebook || {};

    // Объединяем существующие и новые настройки с раздельным хранением токенов
    const updatedSettings = {
      ...existingSocialSettings,
      facebook: {
        ...existingFacebook, // Сохраняем существующие данные
        
        // Основной токен страницы для публикации
        token,
        pageId,
        pageName: pageName || existingFacebook.pageName || '',
        
        // Пользовательский токен для получения списка страниц
        userToken: userAccessToken || existingFacebook.userToken || token,
        
        // Метаданные
        setupCompletedAt: new Date().toISOString(),
        configured: true,
        
        // Дополнительная информация
        tokenType: userAccessToken ? 'page' : 'user' // Определяем тип основного токена
      }
    };

    // Сохраняем обновленные настройки
    const updateResponse = await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        social_media_settings: updatedSettings
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Facebook settings saved successfully', {
      campaignId,
      pageName: pageName,
      hasToken: !!token
    });

    res.json({
      success: true,
      message: 'Facebook настройки сохранены успешно'
    });

  } catch (error: any) {
    console.error('❌ Error saving Facebook settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка сохранения настроек Facebook',
      details: error.message
    });
  }
});

export default router;