import type { Request, Response } from 'express';

/**
 * Корневой `/health` — живость процесса для мониторинга деплоя.
 *
 * Отдельным модулем, а не инлайном в `server/index.ts`: поле `revision` — часть
 * проверки выкатки (AI-50), и оно должно быть покрыто тестом. Импортировать
 * ради этого весь `index.ts` нельзя — он на импорте поднимает сервер.
 *
 * Это НЕ `/api/health` из `server/routes/health.ts`: тот ходит в Directus и S3
 * и отвечает 503 при их недоступности. Здесь намеренно нет внешних вызовов —
 * деплой-скрипт спрашивает «этот ли код сейчас запущен», и ответ не должен
 * зависеть от чужих сервисов.
 */
export function rootHealthHandler(_req: Request, res: Response) {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    // SHA коммита, из которого собран образ. Проставляется build-arg'ом
    // APP_COMMIT_SHA; deploy сверяет это поле с меткой образа и целевым SHA,
    // поэтому «уехал ли код на прод» проверяется полем, а не грепом
    // ASCII-маркеров по бандлу.
    //
    // Нет переменной — 'unknown', а не падение и не пустая строка: локальный
    // запуск и старые окружения обязаны работать, но выдавать себя за
    // выкаченный SHA не должны. Deploy сравнивает на равенство, поэтому
    // 'unknown' никогда не пройдёт проверку.
    revision: process.env.APP_COMMIT_SHA || 'unknown',
  });
}
