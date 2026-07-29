import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth';
import { safeTempFileName, sanitizeFileLabel } from '../utils/media-exec';

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
    // Имя от клиента в путь не попадает. Каталоги из него busboy срезает сам,
    // но `$( )`, `;`, пробелы и переводы строки доезжают как есть — а этот путь
    // потом уходит в файловые операции и в ссылку. Уникальную часть задаём мы,
    // от клиента остаётся только расширение из allowlist.
    const outputFileName = safeTempFileName(`video_${Date.now()}`, req.file.originalname);
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
  // Express не даст сегменту содержать «/», но `%2e%2e%2f` он декодирует ПОСЛЕ
  // сопоставления маршрута — в обработчик приходит уже `../`. Поэтому имя
  // приводится к безопасному виду, а результат дополнительно проверяется на
  // принадлежность каталогу раздачи: одной санитизации мало, если она когда-то
  // ослабнет.
  const filename = sanitizeFileLabel(req.params.filename, '');
  if (!filename) {
    return res.status(400).json({ error: 'Недопустимое имя файла' });
  }

  const baseDir = path.resolve(__dirname, '../../uploads/processed');
  const filePath = path.resolve(baseDir, filename);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
    return res.status(400).json({ error: 'Недопустимое имя файла' });
  }

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