import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();
const upload = multer({ dest: 'uploads/temp/' });

// Базовая обработка видео (пока без FFmpeg)
router.post('/process', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Видео файл не найден' });
    }

    const { textOverlays, campaignId } = req.body;
    console.log('[VIDEO] Processing request:', {
      originalName: req.file.originalname,
      size: req.file.size,
      campaignId,
      overlaysCount: JSON.parse(textOverlays || '[]').length
    });

    // Пока просто сохраняем файл и возвращаем успех
    // В будущем здесь будет FFmpeg обработка
    const outputFileName = `video_${Date.now()}_${req.file.originalname}`;
    const outputPath = path.join('uploads/processed/', outputFileName);

    // Создаем папку если не существует
    if (!fs.existsSync('uploads/processed/')) {
      fs.mkdirSync('uploads/processed/', { recursive: true });
    }

    // Копируем файл (временно, пока не добавим FFmpeg)
    fs.copyFileSync(req.file.path, outputPath);
    fs.unlinkSync(req.file.path); // Удаляем временный

    console.log('[VIDEO] Video processed successfully:', outputPath);

    res.json({
      success: true,
      videoUrl: `/uploads/processed/${outputFileName}`,
      message: 'Видео сохранено (обработка текста будет добавлена позже)'
    });

  } catch (error) {
    console.error('[VIDEO] Error processing video:', error);
    res.status(500).json({
      error: 'Ошибка обработки видео',
      details: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
  }
});

// Раздача обработанных видео файлов
router.get('/uploads/processed/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '../../uploads/processed', filename);
  
  // Проверяем существование файла
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  // Устанавливаем правильные заголовки
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  
  // Отправляем файл
  res.sendFile(filePath);
});

export default router;