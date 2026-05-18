import { Router } from 'express';
import { cleanHtmlForFacebook } from './facebook-webhook-direct';

const router = Router();

/**
 * Тестовый маршрут для проверки функции очистки HTML для Facebook
 * Принимает POST запрос с полем html и возвращает оригинальный и очищенный текст
 */
router.post('/facebook-cleaning', (req, res) => {
  const { html } = req.body;
  if (!html) {
    return res.status(400).json({ error: 'HTML текст не указан' });
  }
  
  const cleanedHtml = cleanHtmlForFacebook(html);
  
  return res.json({
    original: html,
    cleaned: cleanedHtml
  });
});

/**
 * Тестовые маршруты для проверки обработки HTTP ошибок в production
 */
router.get('/error-401', (req, res) => {
  return res.status(401).json({ error: 'Unauthorized - test error' });
});

router.get('/error-403', (req, res) => {
  return res.status(403).json({ error: 'Forbidden - test error' });
});

router.get('/error-404', (req, res) => {
  return res.status(404).json({ error: 'Not Found - test error' });
});

router.get('/error-429', (req, res) => {
  return res.status(429).json({ error: 'Too Many Requests - test error' });
});

router.get('/error-500', (req, res) => {
  return res.status(500).json({ error: 'Internal Server Error - test error' });
});

export default router;