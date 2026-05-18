import express from 'express';
import axios from 'axios';

const router = express.Router();

/**
 * Общий роут для обновления настроек кампании (PATCH /api/campaigns/:id)
 * Используется для обновления trend_analysis_settings и других полей
 */
router.patch('/campaigns/:id', async (req, res) => {
  const { id } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация'
      });
    }

    // Обновляем кампанию с переданными полями
    const updateResponse = await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${id}`,
      req.body,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      data: updateResponse.data.data
    });

  } catch (error: any) {
    console.error('❌ Error updating campaign settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при обновлении настроек кампании',
      details: error.message
    });
  }
});

export default router;
