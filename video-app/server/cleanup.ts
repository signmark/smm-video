import fs from 'fs/promises';
import { existsSync } from 'fs';
import { listProjects, updateProject, DATA_PATHS } from './db.js';

const RETENTION_DAYS = 3;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export async function cleanupOldVideos(): Promise<void> {
  const now = Date.now();
  let cleaned = 0;

  try {
    const projects = await listProjects();

    for (const project of projects) {
      const age = now - new Date(project.createdAt).getTime();
      if (age < RETENTION_MS) continue;

      const videoPath = DATA_PATHS.videoFile(project.id);
      const imagesDir = DATA_PATHS.imagesDir(project.id);

      let hadFiles = false;

      if (existsSync(videoPath)) {
        await fs.unlink(videoPath).catch(() => {});
        hadFiles = true;
      }

      if (existsSync(imagesDir)) {
        await fs.rm(imagesDir, { recursive: true, force: true }).catch(() => {});
        hadFiles = true;
      }

      if (hadFiles || project.videoPath || project.videoUrl) {
        await updateProject(project.id, {
          videoPath: undefined,
          videoUrl: undefined,
        });
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[cleanup] Удалены видеофайлы ${cleaned} проект(ов) старше ${RETENTION_DAYS} дней`);
    } else {
      console.log('[cleanup] Нет файлов для удаления');
    }
  } catch (err: any) {
    console.warn('[cleanup] Ошибка при очистке:', err.message);
  }
}

export function scheduleCleanup(): void {
  cleanupOldVideos();
  setInterval(cleanupOldVideos, 24 * 60 * 60 * 1000);
  console.log(`[cleanup] Запланирована ежесуточная очистка видео старше ${RETENTION_DAYS} дней`);
}
