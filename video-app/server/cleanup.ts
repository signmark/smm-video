import fs from 'fs/promises';
import { listProjects, updateProject, DATA_PATHS, RETENTION_DAYS } from './db.js';

const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Возраст артефакта в миллисекундах; `null` — файла (или папки) нет. */
export type ArtifactAges = { video: number | null; images: number | null };

export interface CleanupPlan {
  deleteVideo: boolean;
  deleteImages: boolean;
  /** Чистить `videoPath`/`videoUrl` в проекте — только если файл действительно удалён. */
  clearRow: boolean;
}

/**
 * Срок хранения считается по возрасту самого артефакта, а не по дате создания
 * проекта. Проект живёт месяцами и пересобирается: у июльского проекта может
 * быть сегодняшний ролик. Раньше возраст брался из `project.createdAt`, и это
 * давало две поломки на ровном месте:
 *
 *  1. свежий ролик, пересобранный в старом проекте, удалялся при ближайшем
 *     перезапуске контейнера — владелец платил за генерацию, а файл исчезал;
 *  2. очистка, попавшая на середину генерации в старом проекте, сносила папку
 *     с уже готовыми кадрами прямо под работающим пайплайном.
 *
 * Каждый артефакт судится по своему mtime, поэтому то, что пишется прямо
 * сейчас, под удаление не попадает никогда.
 */
export function planCleanup(ages: ArtifactAges, retentionMs: number): CleanupPlan {
  const expired = (age: number | null) => age !== null && age >= retentionMs;
  const deleteVideo = expired(ages.video);
  return { deleteVideo, deleteImages: expired(ages.images), clearRow: deleteVideo };
}

async function ageOf(path: string, now: number): Promise<number | null> {
  try {
    const stat = await fs.stat(path);
    return now - stat.mtimeMs;
  } catch {
    return null;
  }
}

export async function cleanupOldVideos(): Promise<void> {
  const now = Date.now();
  let cleaned = 0;

  try {
    const projects = await listProjects();

    for (const project of projects) {
      const videoPath = DATA_PATHS.videoFile(project.id);
      const imagesDir = DATA_PATHS.imagesDir(project.id);

      const plan = planCleanup(
        { video: await ageOf(videoPath, now), images: await ageOf(imagesDir, now) },
        RETENTION_MS,
      );

      if (plan.deleteVideo) await fs.unlink(videoPath).catch(() => {});
      if (plan.deleteImages) await fs.rm(imagesDir, { recursive: true, force: true }).catch(() => {});

      if (plan.clearRow) {
        await updateProject(project.id, { videoPath: undefined, videoUrl: undefined });
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
