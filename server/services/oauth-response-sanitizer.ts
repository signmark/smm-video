export function sanitizeFacebookAccount(account: any) {
  return {
    id: account?.id,
    name: account?.name,
    category: account?.category,
    tasks: account?.tasks,
    link: account?.link,
    fan_count: Number(account?.fan_count || 0),
    hasAccessToken: Boolean(account?.access_token),
  };
}

export function sanitizeInstagramAccount(account: any) {
  return {
    instagramId: account?.instagramId,
    username: account?.username,
    name: account?.name,
    pageId: account?.pageId,
    pageName: account?.pageName,
  };
}

const SECRET_KEYS = new Set([
  'token', 'accesstoken', 'refreshtoken', 'longlivedtoken', 'pageaccesstoken', 'usertoken',
  'appsecret', 'clientsecret', 'password', 'apikey', 'apisecret',
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

/** Removes credential material at any depth before data crosses into the browser. */
export function sanitizeOAuthSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeOAuthSecrets) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEYS.has(normalizedKey(key)))
    .map(([key, child]) => [key, sanitizeOAuthSecrets(child)])) as T;
}

/** Merges editable settings while retaining server-side secrets omitted by sanitized clients. */
export function mergeOAuthSettings(existing: any, incoming: any): any {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const result: Record<string, unknown> = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_KEYS.has(normalizedKey(key))) {
      if (value !== '' && value !== null && value !== undefined) result[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeOAuthSettings(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
