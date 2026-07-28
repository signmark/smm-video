import express from 'express';
import axios from 'axios';
import { clearContentCache } from '../utils/content-cache';
import { authenticateUser } from '../middleware/user-auth';
import { assertContentBelongsToRequester } from '../services/content-access';

const router = express.Router();

/**
 * Полное удаление контента из базы данных
 * DELETE /api/content/:id
 *
 * Владение проверяется явно: права Directus здесь не защищают — соседние ручки
 * показали, что чужой контент через них доступен (находка ревью 2026-07-28).
 */
router.delete('/content/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Требуется авторизация'
      });
    }

    if (!(await assertContentBelongsToRequester(id, req, res))) return;

    await axios.delete(
      `${process.env.DIRECTUS_URL}/items/campaign_content/${id}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    clearContentCache();

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
