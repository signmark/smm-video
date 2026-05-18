/**
 * Регистрация маршрутов для Beget S3 хранилища
 */
import { Express } from 'express';
import begetS3AwsRouter from './routes/beget-s3-aws';
import begetS3VideoRouter from './routes/beget-s3-video';
import { log } from './utils/logger';

/**
 * Регистрирует маршруты для работы с Beget S3 хранилищем
 * @param app Express приложение
 */
export function registerBegetS3Routes(app: Express): void {
  log("Registering Beget S3 storage routes...", "beget-s3-routes");
  
  // Регистрируем основные маршруты для работы с S3
  app.use('/api/beget-s3', begetS3AwsRouter);
  log("Beget S3 basic storage routes registered", "beget-s3-routes");
  
  // Регистрируем маршруты для работы с видео в S3
  app.use('/api/beget-s3-video', begetS3VideoRouter);
  log("Beget S3 video routes registered", "beget-s3-routes");
  
  log("All Beget S3 routes registered successfully", "beget-s3-routes");
}