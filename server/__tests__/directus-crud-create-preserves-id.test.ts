import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { DirectusCrud } from '../services/directus-crud';

/**
 * Task #34 Phase A — linchpin proof (per @Clause_Dev_Hermi):
 * `directusCrud.create` must NOT strip a client-provided `id` from the POST body.
 *
 * This is the load-bearing assumption of the preallocated-content_id design:
 * `content_id` is generated at RESERVATION time and stored in the ledger row;
 * creating `campaign_content` with that explicit id, and retry-after-crash
 * getting RECORD_NOT_UNIQUE (='already created') — both depend on the wrapper
 * passing the client id through untouched. @Clause_Dev_Hermi verified this with
 * a bare fetch on prod; this test verifies OUR wrapper, not to be taken on faith.
 */

// Mock axios: capture the POST url + body for /items/campaign_content.
const posts: Array<{ url: string; data: any }> = [];
vi.mock('axios', () => {
  const defaultFn: any = vi.fn(async (cfg: any) => {
    if (cfg.method === 'post') posts.push({ url: cfg.url, data: cfg.data });
    return { data: { data: cfg.data } };
  });
  defaultFn.create = vi.fn(() => ({
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), interceptors: {},
  }));
  defaultFn.get = vi.fn(async () => ({ data: {} }));
  defaultFn.post = vi.fn(async (url: string, data: any) => {
    posts.push({ url, data });
    return { data: { data } };
  });
  defaultFn.patch = vi.fn(async () => ({ data: {} }));
  defaultFn.delete = vi.fn(async () => ({ data: {} }));
  defaultFn.interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
  return { default: defaultFn };
});

describe('SM-20 Phase A: directusCrud.create preserves client id', () => {
  let crud: DirectusCrud;

  beforeEach(() => {
    posts.length = 0;
    process.env.NODE_ENV = 'test';
    process.env.DIRECTUS_URL = 'https://directus.test';
    crud = new DirectusCrud();
  });
  afterEach(() => {
    delete process.env.DIRECTUS_URL;
  });

  it('POST body содержит переданный клиентский id без изменений', async () => {
    const clientId = '11111111-2222-4333-8444-555555555555';
    await crud.create('campaign_content', {
      id: clientId,
      campaign_id: 'c1',
      title: 'X',
      content: 'Y',
      status: 'draft',
      source: 'ai_generated',
    }, { authToken: 'test-token' });

    expect(posts.length).toBe(1);
    const body = posts[0].data;
    expect(body.id).toBe(clientId);
  });

  it('POST без клиентского id не добавляет его насильно', async () => {
    await crud.create('campaign_content', {
      campaign_id: 'c1', title: 'X', content: 'Y', status: 'draft',
    }, { authToken: 'test-token' });

    expect(posts.length).toBe(1);
    // нет id — Directus сам сгенерирует; wrapper не должен добавлять фиктивный.
    expect('id' in posts[0].data).toBe(false);
  });
});
