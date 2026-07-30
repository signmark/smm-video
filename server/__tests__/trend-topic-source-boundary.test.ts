/**
 * createTrendTopic: source_id обязан принадлежать той же кампании.
 *
 * Находка ревью 2026-07-29: владение проверялось только для campaign_id, а
 * source_id принимался любым. Тренд со ссылкой на чужой источник становился
 * мостом между арендаторами — через analyze-comments(level=source) по нему
 * читались чужие тренды и перезаписывался sentiment_analysis чужого источника.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  crudList: vi.fn(async () => [] as any[]),
  crudGetById: vi.fn(async () => null as any),
  crudCreate: vi.fn(async () => ({ id: 'trend-new' })),
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: H.crudList,
    getById: H.crudGetById,
    create: H.crudCreate,
    update: vi.fn(),
    delete: vi.fn(),
    custom: vi.fn(),
  },
}));

import { directusProxy } from '../services/directus-proxy';

const OWN = 'campaign-own';
const FOREIGN = 'campaign-foreign';
const USER = 'user-1';
const TOKEN = 'user-token';

beforeEach(() => {
  vi.clearAllMocks();
  // Пользователь владеет только OWN: getUserCampaign читает user_campaigns списком.
  H.crudList.mockImplementation(async (collection: any, opts: any) => {
    if (collection === 'user_campaigns' && opts?.filter?.id?._eq === OWN) return [{ id: OWN, user_id: USER }];
    return [];
  });
  H.crudCreate.mockResolvedValue({ id: 'trend-new' });
});

const create = (data: any) => directusProxy.createTrendTopic({ data, userId: USER, token: TOKEN });

describe('createTrendTopic — граница арендатора по source_id', () => {
  it('своя кампания + ЧУЖОЙ source_id → отказ, тренд не создаётся', async () => {
    H.crudGetById.mockResolvedValue({ id: 'source-foreign', campaign_id: FOREIGN });

    await expect(create({ title: 't', campaign_id: OWN, source_id: 'source-foreign' }))
      .rejects.toThrow(/not found/i);
    expect(H.crudCreate).not.toHaveBeenCalled();
  });

  it('несуществующий source_id → отказ без oracle, тренд не создаётся', async () => {
    H.crudGetById.mockResolvedValue(null);

    await expect(create({ title: 't', campaign_id: OWN, source_id: 'source-ghost' }))
      .rejects.toThrow(/not found/i);
    expect(H.crudCreate).not.toHaveBeenCalled();
  });

  it('source_id своей кампании — тренд создаётся', async () => {
    H.crudGetById.mockResolvedValue({ id: 'source-own', campaign_id: OWN });

    const created = await create({ title: 't', campaign_id: OWN, source_id: 'source-own' });

    expect(created).toEqual({ id: 'trend-new' });
    expect(H.crudCreate).toHaveBeenCalledTimes(1);
  });

  it('тренд без source_id создаётся как раньше', async () => {
    const created = await create({ title: 't', campaign_id: OWN });

    expect(created).toEqual({ id: 'trend-new' });
    expect(H.crudGetById).not.toHaveBeenCalled();
    expect(H.crudCreate).toHaveBeenCalledTimes(1);
  });

  it('чужая кампания по-прежнему отклоняется до любых чтений источника', async () => {
    await expect(create({ title: 't', campaign_id: FOREIGN, source_id: 'source-foreign' }))
      .rejects.toThrow('Access denied');
    expect(H.crudGetById).not.toHaveBeenCalled();
    expect(H.crudCreate).not.toHaveBeenCalled();
  });
});
