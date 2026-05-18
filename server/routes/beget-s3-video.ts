/**
 * API маршруты для работы с видео в Beget S3
 */
import { Router } from 'express';
import { begetS3VideoService } from '../services/beget-s3-video-service';
import { log } from '../utils/logger';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const logPrefix = 'beget-s3-video-api';

// Настройка multer для загрузки видео
const tempDir = path.join(os.tmpdir(), 'beget-s3-video-uploads');

// Создаем временную директорию, если ее нет
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  log.info(`Created temporary directory for video uploads: ${tempDir}`, logPrefix);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

// Ограничиваем размер загружаемых файлов до 1024MB (1GB)
const upload = multer({ 
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }
});

// Загрузка видео из URL
router.post('/upload-from-url', authMiddleware, async (req, res) => {
  try {
    const { videoUrl, generateThumbnail = true } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ success: false, error: 'Video URL is required' });
    }

    log.info(`Received request to upload video from URL: ${videoUrl}`, logPrefix);
    
    const result = await begetS3VideoService.uploadVideoFromUrl(videoUrl, generateThumbnail);

    if (!result.success) {
      return res.status(500).json({ 
        success: false, 
        error: result.error || 'Error uploading video from URL' 
      });
    }

    return res.json({
      success: true,
      videoUrl: result.videoUrl,
      thumbnailUrl: result.thumbnailUrl,
      metadata: result.metadata,
      key: result.key
    });
  } catch (error) {
    log.error(`Error in upload-video-from-url endpoint: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Загрузка видео из локального файла
router.post('/upload', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No video file provided' });
    }

    const filePath = req.file.path;
    const generateThumbnail = req.body.generateThumbnail !== 'false';

    log.info(`Received request to upload video from file: ${filePath}`, logPrefix);
    
    const result = await begetS3VideoService.uploadLocalVideo(filePath, generateThumbnail);

    // Удаляем временный файл
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkError) {
      log.error(`Error deleting temporary video file: ${(unlinkError as Error).message}`, logPrefix);
    }

    if (!result.success) {
      return res.status(500).json({ 
        success: false, 
        error: result.error || 'Error uploading video' 
      });
    }

    return res.json({
      success: true,
      videoUrl: result.videoUrl,
      thumbnailUrl: result.thumbnailUrl,
      metadata: result.metadata,
      key: result.key
    });
  } catch (error) {
    log.error(`Error in upload-video endpoint: ${(error as Error).message}`, logPrefix);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;