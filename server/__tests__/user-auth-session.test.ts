import { beforeEach, describe, expect, it, vi } from 'vitest';

const { validateDirectusSession, cacheAuthToken } = vi.hoisted(() => ({
  validateDirectusSession: vi.fn(),
  cacheAuthToken: vi.fn(),
}));

vi.mock('../directus', () => ({
  directusApiManager: { cacheAuthToken },
}));

vi.mock('../services/directus-session-validator', () => ({
  validateDirectusSession,
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getUserData: () => ({ is_smm_admin: false }),
  },
}));

import { authenticateUser } from '../middleware/user-auth';

function makeToken(exp: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ id: 'user-1', exp })}.signature`;
}

function makeResponse() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('authenticateUser session validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'https://test-directus.example.com';
    process.env.DIRECTUS_STATIC_TOKEN = 'admin-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { is_smm_admin: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  it('returns an explicit 401 for an expired token without continuing the request', async () => {
    const token = makeToken(Math.floor(Date.now() / 1000) - 1);
    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res = makeResponse();
    const next = vi.fn();

    await authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_SESSION_INVALID' }));
    expect(validateDirectusSession).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 401, 'AUTH_SESSION_INVALID'],
    ['unavailable', 503, 'AUTH_VALIDATION_UNAVAILABLE'],
  ] as const)('maps Directus %s validation to HTTP %s', async (result, status, code) => {
    validateDirectusSession.mockResolvedValue(result);
    const token = makeToken(Math.floor(Date.now() / 1000) + 3600);
    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res = makeResponse();
    const next = vi.fn();

    await authenticateUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
    expect(next).not.toHaveBeenCalled();
  });

  it('continues only after Directus confirms the session', async () => {
    validateDirectusSession.mockResolvedValue('valid');
    const token = makeToken(Math.floor(Date.now() / 1000) + 3600);
    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res = makeResponse();
    const next = vi.fn();

    await authenticateUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(expect.objectContaining({ id: 'user-1', token }));
    expect(cacheAuthToken).toHaveBeenCalled();
  });
});
