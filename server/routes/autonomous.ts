import { Router, Request, Response } from 'express';
import {
  startAutonomousExternal,
  stopAutonomousExternal,
  pauseAutonomousExternal,
  resumeAutonomousExternal,
  updateAutonomousSettingsExternal,
  getAutonomousStatusExternal,
  getAllAutonomousStatuses,
  getActiveAutonomousCampaignIds,
  approvePipelinePlan,
  rejectPipelinePlan,
} from '../services/autonomous-ai';
import type { ContentPlanItem } from '../services/autonomous-ai';
import { directusCrud } from '../services/directus-crud';
import { authenticateUser } from '../middleware/user-auth';
import {
  authorizeCampaignAccess,
  listAccessibleCampaignIds,
  CampaignAccessError,
} from '../services/campaign-access';

const router = Router();

// Весь роутер требует сессии: до этого запуск, остановка и статусы автономного
// режима в ЧУЖОЙ кампании были доступны кому угодно (находка ревью 2026-07-28).
router.use(authenticateUser);

/**
 * Доступ к кампании. Сам пишет ответ и возвращает false при отказе
 * (404 — не раскрываем существование чужой кампании; 503 — Directus недоступен).
 */
async function ensureCampaignAccess(req: Request, res: Response, campaignId: string): Promise<boolean> {
  try {
    await authorizeCampaignAccess(
      campaignId,
      (req as any).user?.id,
      (req as any).user?.token || '',
      (req as any).user?.is_smm_admin === true,
    );
    return true;
  } catch (e: any) {
    if (e instanceof CampaignAccessError && e.status === 503) {
      res.status(503).json({ error: 'Проверка доступа временно недоступна' });
      return false;
    }
    res.status(404).json({ error: 'Кампания не найдена' });
    return false;
  }
}

router.post('/start', async (req: Request, res: Response) => {
  try {
    const { campaignId, interval, postsPerCycle, autoSchedule, platforms, withImages, pipelineMode, refresh_token, auth_token } = req.body;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId обязателен' });
    }
    if (!(await ensureCampaignAccess(req, res, String(campaignId)))) return;

    // userId — только из сессии. Из тела он позволял запустить автономный режим
    // от имени другого пользователя.
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Требуется авторизация' });

    const result = await startAutonomousExternal({
      campaignId, userId, interval, postsPerCycle, autoSchedule, platforms, withImages, pipelineMode,
      refreshToken: refresh_token,
      authToken: auth_token
    });
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/stop', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });
    if (!(await ensureCampaignAccess(req, res, String(campaignId)))) return;
    const result = stopAutonomousExternal(campaignId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// SM-20: пауза и возобновление. Остановка (/stop) удаляет состояние и
// обнуляет прогресс — она не годится, когда нужно просто поправить настройки.
router.post('/pause', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });
    if (!(await ensureCampaignAccess(req, res, String(campaignId)))) return;
    const result = pauseAutonomousExternal(campaignId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/resume', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });
    if (!(await ensureCampaignAccess(req, res, String(campaignId)))) return;
    const result = resumeAutonomousExternal(campaignId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// SM-20: обновление настроек запущенного режима (interval, postsPerCycle,
// autoSchedule, withImages). Режим не выключается, новые значения применяются
// с ближайшего цикла. Если цикл сейчас НЕ идёт — таймеры перепроводятся
// сразу; иначе берутся со следующего цикла.
router.post('/update-settings', async (req: Request, res: Response) => {
  try {
    const { campaignId, interval, postsPerCycle, autoSchedule, withImages } = req.body || {};
    if (!campaignId) return res.status(400).json({ error: 'campaignId обязателен' });
    if (!(await ensureCampaignAccess(req, res, String(campaignId)))) return;
    if (typeof interval !== 'number' || interval <= 0) {
      return res.status(400).json({ error: 'interval должен быть положительным числом' });
    }
    if (typeof postsPerCycle !== 'number' || postsPerCycle <= 0) {
      return res.status(400).json({ error: 'postsPerCycle должен быть положительным числом' });
    }
    const result = updateAutonomousSettingsExternal(String(campaignId), {
      interval,
      postsPerCycle,
      autoSchedule: typeof autoSchedule === 'boolean' ? autoSchedule : undefined,
      withImages: typeof withImages === 'boolean' ? withImages : undefined,
    });
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/status/:campaignId', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    if (!(await ensureCampaignAccess(req, res, campaignId))) return;
    const status = getAutonomousStatusExternal(campaignId);
    return res.json(status);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/all', async (req: Request, res: Response) => {
  try {
    // Отдаём только свои кампании: раньше ручка возвращала статусы всех.
    const accessible = new Set(await listAccessibleCampaignIds(
      (req as any).user?.id,
      (req as any).user?.token || '',
    ));
    const isAdmin = (req as any).user?.is_smm_admin === true;

    const all = getAllAutonomousStatuses() as Record<string, any>;
    if (isAdmin) return res.json(all);

    const mine = Object.fromEntries(
      Object.entries(all ?? {}).filter(([campaignId]) => accessible.has(campaignId)),
    );
    return res.json(mine);
  } catch (e: any) {
    if (e instanceof CampaignAccessError && e.status === 503) {
      return res.status(503).json({ error: 'Проверка доступа временно недоступна' });
    }
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/autonomous/active-ids — список campaignId с активным ассистентом (из Directus)
router.get('/active-ids', async (req: Request, res: Response) => {
  try {
    const items = await directusCrud.list<{ campaign_id: string }>('autonomous_sessions', {
      filter: { is_active: { _eq: true } },
      fields: ['campaign_id'],
      limit: 200,
      useAdminToken: true,
    });
    const ids: string[] = (items ?? []).map((s) => s.campaign_id).filter(Boolean);

    // Список читается админским токеном — фильтруем по доступным кампаниям,
    // иначе он раскрывает id чужих кампаний с активным ассистентом.
    if ((req as any).user?.is_smm_admin === true) return res.json({ ids });

    const accessible = new Set(await listAccessibleCampaignIds(
      (req as any).user?.id,
      (req as any).user?.token || '',
    ));
    return res.json({ ids: ids.filter((id) => accessible.has(id)) });
  } catch (e: any) {
    // Fail-closed: при сбое отдаём пустой список, а не чужие id.
    return res.json({ ids: [] });
  }
});

// POST /api/autonomous/approve-plan/:campaignId
// Одобряет ожидающий контент-план (опционально с изменёнными элементами)
router.post('/approve-plan/:campaignId', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    if (!(await ensureCampaignAccess(req, res, campaignId))) return;
    const updatedItems: ContentPlanItem[] | undefined = Array.isArray(req.body?.items)
      ? req.body.items
      : undefined;
    const result = approvePipelinePlan(campaignId, updatedItems);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/autonomous/reject-plan/:campaignId
// Отклоняет план — цикл завершается без публикации
router.post('/reject-plan/:campaignId', async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    if (!(await ensureCampaignAccess(req, res, campaignId))) return;
    const result = rejectPipelinePlan(campaignId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
