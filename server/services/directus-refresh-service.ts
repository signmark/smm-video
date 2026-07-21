import { createHash } from 'node:crypto';
import { directusApiManager } from '../directus';

export type DirectusRefreshResult =
  | { status: 'success'; userId: string; user: any; accessToken: string; refreshToken: string; expiresAt?: number }
  | { status: 'invalid' | 'rate_limited' | 'unavailable' };

export interface DirectusRefreshDependencies {
  refresh(refreshToken: string): Promise<any>;
  getCurrentUser(accessToken: string): Promise<any>;
}

const inFlightRefreshes = new Map<string, Promise<DirectusRefreshResult>>();

const defaultDependencies: DirectusRefreshDependencies = {
  refresh: (refreshToken) => directusApiManager.post('/auth/refresh', { refresh_token: refreshToken, mode: 'json' }),
  getCurrentUser: (accessToken) => directusApiManager.get(
    '/users/me?fields=id,email,first_name,last_name,is_smm_admin',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ),
};

function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function classifyFailure(error: any): DirectusRefreshResult {
  const status = Number(error?.response?.status || 0);
  if (status === 400 || status === 401) return { status: 'invalid' };
  if (status === 429) return { status: 'rate_limited' };
  return { status: 'unavailable' };
}

async function performRefresh(refreshToken: string, dependencies: DirectusRefreshDependencies): Promise<DirectusRefreshResult> {
  try {
    const refreshResponse = await dependencies.refresh(refreshToken);
    const data = refreshResponse?.data?.data;
    if (!data?.access_token || !data?.refresh_token) return { status: 'unavailable' };

    const userResponse = await dependencies.getCurrentUser(data.access_token);
    const user = userResponse?.data?.data;
    if (!user?.id) return { status: 'unavailable' };

    return {
      status: 'success',
      userId: String(user.id),
      user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };
  } catch (error) {
    return classifyFailure(error);
  }
}

export function refreshDirectusSession(
  refreshToken: string,
  dependencies: DirectusRefreshDependencies = defaultDependencies,
): Promise<DirectusRefreshResult> {
  const key = fingerprint(refreshToken);
  const existing = inFlightRefreshes.get(key);
  if (existing) return existing;

  const refresh = performRefresh(refreshToken, dependencies).finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, refresh);
  return refresh;
}

export function resetDirectusRefreshCoordinatorForTests(): void {
  inFlightRefreshes.clear();
}
