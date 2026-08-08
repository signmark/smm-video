/**
 * Security §4 (2026-07-24): hardened image upload route.
 * - Явный лимит размера (multer limits + повторная проверка)
 * - MIME allowlist + magic bytes sniffing (содержимое должно соответствовать заявленному типу)
 * - S3 key и расширение генерируются на сервере (originalname клиента не используется)
 * - Внутренний error.message не возвращается клиенту
 * См. docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md §4.
 */
import { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { authMiddleware } from '../middleware/auth';
import { log } from '../utils/logger';

export const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Определяет тип изображения по magic bytes. null = не изображение из allowlist. */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export type UploadValidation =
  | { ok: true; contentType: string; ext: string }
  | { ok: false; status: 413 | 415; error: string };

export function validateImageUpload(file: {
  size: number;
  mimetype?: string;
  buffer: Buffer;
}): UploadValidation {
  if (file.size > UPLOAD_IMAGE_MAX_BYTES || file.buffer.length > UPLOAD_IMAGE_MAX_BYTES) {
    return { ok: false, status: 413, error: 'Файл слишком большой (макс. 10 МБ)' };
  }
  const declared = (file.mimetype || '').toLowerCase();
  if (!MIME_TO_EXT[declared]) {
    return {
      ok: false,
      status: 415,
      error: 'Недопустимый тип файла: разрешены JPEG, PNG, WebP, GIF',
    };
  }
  const sniffed = sniffImageType(file.buffer);
  if (sniffed !== declared) {
    return {
      ok: false,
      status: 415,
      error: 'Содержимое файла не соответствует изображению заявленного типа',
    };
  }
  return { ok: true, contentType: sniffed, ext: MIME_TO_EXT[sniffed] };
}

/** Серверная генерация ключа: клиентское имя файла не участвует. */
export function buildStorageKey(ext: string): string {
  return `stories/story-${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
}

export interface S3Uploader {
  uploadFile(args: {
    key: string;
    fileData: Buffer;
    contentType: string;
  }): Promise<{ success: boolean; url?: string; error?: string }>;
}

export function registerUploadImageRoute(app: Express, createS3: () => S3Uploader): void {
  const uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_IMAGE_MAX_BYTES, files: 1 },
  });

  const receiveFile = (req: Request, res: Response, next: NextFunction) => {
    uploadMiddleware.single('image')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(413)
            .json({ success: false, error: 'Файл слишком большой (макс. 10 МБ)' });
        }
        log.error('[s3-upload-file] Ошибка приёма файла:', (err as Error)?.message);
        return res.status(400).json({ success: false, error: 'Не удалось принять файл' });
      }
      return next();
    });
  };

  app.post('/api/s3/upload-image', authMiddleware, receiveFile, async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, error: 'Отсутствует файл изображения' });
      }

      const validation = validateImageUpload(file);
      if (!validation.ok) {
        return res.status(validation.status).json({ success: false, error: validation.error });
      }

      const key = buildStorageKey(validation.ext);
      const result = await createS3().uploadFile({
        key,
        fileData: file.buffer,
        contentType: validation.contentType,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || 'S3 upload failed');
      }

      log('[s3-upload-file] Загружено на S3:', result.url);
      return res.json({
        success: true,
        data: { url: result.url, display_url: result.url, link: result.url },
      });
    } catch (error: any) {
      // Детали — только в серверный лог; клиенту generic-ответ (security §4).
      log.error('[s3-upload-file] Ошибка загрузки:', error?.message);
      return res.status(500).json({ success: false, error: 'Ошибка загрузки изображения' });
    }
  });
}
