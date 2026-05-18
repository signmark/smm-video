import { Router, Request, Response } from 'express';
import {
  startAutonomousExternal,
  stopAutonomousExternal,
  getAutonomousStatusExternal,
  getAllAutonomousStatuses,
  getActiveAutonomousCampaignIds,
  approvePipelinePlan,
  rejectPipelinePlan,
} from '../services/autonomous-ai';
import type { ContentPlanItem } from '../services/autonomous-ai';
import { directusCrud } from '../services/directus-crud';

const router = Router();

router.post('/start', async (req: Request, res: Response) => {
  try {
    const { campaignId, userId, interval, postsPerCycle, autoSchedule, platforms, withImages, pipelineMode, refresh_token, auth_token } = req.body;
    if (!campaignId || !userId) {
      return res.status(400).json({ error: 'campaignId и userId обязательны' });
    }
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
    const result = stopAutonomousExternal(campaignId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/status/:campaignId', (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const status = getAutonomousStatusExternal(campaignId);
    return res.json(status);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/all', (_req: Request, res: Response) => {
  try {
    return res.json(getAllAutonomousStatuses());
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/autonomous/active-ids — список campaignId с активным ассистентом (из Directus)
router.get('/active-ids', async (_req: Request, res: Response) => {
  try {
    const items = await directusCrud.list<{ campaign_id: string }>('autonomous_sessions', {
      filter: { is_active: { _eq: true } },
      fields: ['campaign_id'],
      limit: 200,
      useAdminToken: true,
    });
    const ids: string[] = (items ?? []).map((s) => s.campaign_id).filter(Boolean);
    return res.json({ ids });
  } catch (e: any) {
    return res.json({ ids: [] });
  }
});

// POST /api/autonomous/approve-plan/:campaignId
// Одобряет ожидающий контент-план (опционально с изменёнными элементами)
router.post('/approve-plan/:campaignId', (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
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
router.post('/reject-plan/:campaignId', (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const result = rejectPipelinePlan(campaignId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
