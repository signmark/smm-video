import express from 'express';
import axios from 'axios';

const router = express.Router();

/**
 * Полное удаление контента из базы данных
 * DELETE /api/content/:id
 */
router.delete('/content/:id', async (req, res) => {
  const { id } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация'
      });
    }

    await axios.delete(
      `${process.env.DIRECTUS_URL}/items/campaign_content/${id}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: 'Контент успешно удален'
    });

  } catch (error: any) {
    console.error('Error deleting content:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при удалении контента',
      details: error.message
    });
  }
});

export default router;
