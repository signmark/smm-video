/**
 * SM-20: роут /api/autonomous/update-settings.
 *
 * Дополняет сервисный тест `autonomous-update-settings.test.ts`. Сервисный
 * тест проверяет саму функцию `updateAutonomousSettingsExternal`. Здесь —
 * контракт роута: тело, авторизация, обработка ошибок.
 *
 * Acceptance (terminal #3):
 * - Тело запроса: { campaignId, interval, postsPerCycle, autoSchedule?, withImages? }.
 * - 400 на отсутствие campaignId, на negative interval/postsPerCycle.
 * - 401/404 на чужую кампанию (через ensureCampaignAccess).
 * - 200 + { success: true, changed: { interval, postsPerCycle } } при успехе.
 * - 200 + { success: false, error: '...' } на неактивный режим.
 *
 * RED-BEFORE: на main без роута все запросы возвращают 404 (Not Found).
 * После ветки — зелёные.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const H = vi.hoisted(() => ({
  // Подмены для зависимостей роута /autonomous.
  CampaignAccessError: class extends Error {
    constructor(public readonly status: 404 | 503, public readonly code: string) {
      super(code);
    }
  },
  authorizeCampaignAccess: vi.fn(),
  authenticateUser: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'user-token' };
    next();
  }),
  updateAutonomousSettingsExternal: vi.fn(),
}));

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: H.authorizeCampaignAccess,
  listAccessibleCampaignIds: vi.fn(async () => []),
  CampaignAccessError: H.CampaignAccessError,
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: H.authenticateUser,
}));

vi.mock('../services/autonomous-ai', () => ({
  updateAutonomousSettingsExternal: H.updateAutonomousSettingsExternal,
}));

import autonomousRouter from '../routes/autonomous';

async function makeApp() {
  vi.resetModules();
  const app = express();
  app.use(express.json());
  app.use('/api/autonomous', autonomousRouter);
  return app;
}

beforeEach(() => {
  H.authorizeCampaignAccess.mockReset();
  H.updateAutonomousSettingsExternal.mockReset();
  H.authenticateUser.mockReset();
  H.authenticateUser.mockImplementation((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', token: 'user-token' };
    next();
  });
});

describe('POST /api/autonomous/update-settings (SM-20)', () => {
  it('400 если campaignId отсутствует', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/autonomous/update-settings')
      .send({ interval: 24, postsPerCycle: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('campaignId');
  });

  it('400 если interval невалиден (0, отрицательный, не число)', async () => {
    const app = await makeApp();
    for (const bad of [0, -1, 'abc', undefined]) {
      const res = await request(app)
        .post('/api/autonomous/update-settings')
        .send({ campaignId: 'c1', interval: bad, postsPerCycle: 1 });
      expect(res.status).toBe(400);
    }
  });

  it('400 если postsPerCycle невалиден', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/autonomous/update-settings')
      .send({ campaignId: 'c1', interval: 24, postsPerCycle: 0 });
    expect(res.status).toBe(400);
  });

  it('200 + { success:true, changed: {...} } при успешном обновлении', async () => {
    H.authorizeCampaignAccess.mockResolvedValue(undefined);
    H.updateAutonomousSettingsExternal.mockReturnValue({
      success: true,
      changed: { interval: 6, postsPerCycle: 3 },
    });
    const app = await makeApp();
    const res = await request(app)
      .post('/api/autonomous/update-settings')
      .send({ campaignId: 'c1', interval: 6, postsPerCycle: 3 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.changed).toEqual({ interval: 6, postsPerCycle: 3 });
  });

  it('200 + { success:false, error } когда автономный режим не активен', async () => {
    H.authorizeCampaignAccess.mockResolvedValue(undefined);
    H.updateAutonomousSettingsExternal.mockReturnValue({
      success: false,
      error: 'Автономный режим не активен',
    });
    const app = await makeApp();
    const res = await request(app)
      .post('/api/autonomous/update-settings')
      .send({ campaignId: 'c1', interval: 6, postsPerCycle: 3 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('не активен');
  });

  it('прокидывает autoSchedule и withImages в сервис', async () => {
    H.authorizeCampaignAccess.mockResolvedValue(undefined);
    H.updateAutonomousSettingsExternal.mockReturnValue({
      success: true,
      changed: { interval: 24, postsPerCycle: 1 },
    });
    const app = await makeApp();
    await request(app)
      .post('/api/autonomous/update-settings')
      .send({
        campaignId: 'c1',
        interval: 24,
        postsPerCycle: 1,
        autoSchedule: false,
        withImages: false,
      });
    expect(H.updateAutonomousSettingsExternal).toHaveBeenCalledWith('c1', {
      interval: 24,
      postsPerCycle: 1,
      autoSchedule: false,
      withImages: false,
    });
  });

  it('НЕ вызывает сервис если авторизация не прошла', async () => {
    H.authorizeCampaignAccess.mockRejectedValue(new H.CampaignAccessError(404, 'CAMPAIGN_NOT_FOUND'));
    const app = await makeApp();
    const res = await request(app)
      .post('/api/autonomous/update-settings')
      .send({ campaignId: 'c1', interval: 24, postsPerCycle: 1 });
    expect(res.status).toBe(404);
    expect(H.updateAutonomousSettingsExternal).not.toHaveBeenCalled();
  });

  it('НЕ пробрасывает autoSchedule если он не boolean', async () => {
    H.authorizeCampaignAccess.mockResolvedValue(undefined);
    H.updateAutonomousSettingsExternal.mockReturnValue({
      success: true,
      changed: { interval: 24, postsPerCycle: 1 },
    });
    const app = await makeApp();
    await request(app)
      .post('/api/autonomous/update-settings')
      .send({ campaignId: 'c1', interval: 24, postsPerCycle: 1, autoSchedule: 'yes' });
    expect(H.updateAutonomousSettingsExternal).toHaveBeenCalledWith('c1', {
      interval: 24,
      postsPerCycle: 1,
      autoSchedule: undefined,
      withImages: undefined,
    });
  });
});