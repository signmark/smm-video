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
  'bottoken', 'telegrambottoken',
  'appsecret', 'clientsecret', 'password', 'apikey', 'apisecret',
  // Секрет VK token-webhook: кто им владеет — может писать токены в кампанию.
  // Наружу отдаём только через /prepare (владельцу); из настроек — вырезаем.
  'webhooksecret',
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

/** `bot_token` → `hasBotToken`. Derived from the original key so the UI reads naturally. */
function presenceFlag(key: string): string {
  const camel = key.replace(/[_-]+(.)/g, (_, char: string) => char.toUpperCase());
  return `has${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

const PRESENCE_FLAGS = new Set(
  [...SECRET_KEYS].map(key => normalizedKey(presenceFlag(key))),
);

/** True only for the marker keys this module emits — never for the secret keys themselves. */
function isPresenceFlag(key: string): boolean {
  return PRESENCE_FLAGS.has(normalizedKey(key));
}

/**
 * Removes credential material at any depth before data crosses into the browser.
 * A dropped secret leaves a `has<Key>: true` marker behind: the UI must be able to
 * say "saved" without receiving the secret, and an empty field would otherwise read
 * as "nothing stored". The marker is a boolean — never a placeholder value in the
 * field itself (see rollback 40417eb5).
 */
export function sanitizeOAuthSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeOAuthSecrets) as T;
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(normalizedKey(key))) {
      if (typeof child === 'string' && child.length > 0) result[presenceFlag(key)] = true;
      continue;
    }
    // Стухший флаг из базы игнорируем — источник истины только сам секрет выше.
    if (isPresenceFlag(key)) continue;
    result[key] = sanitizeOAuthSecrets(child);
  }
  return result as T;
}

/** Merges editable settings while retaining server-side secrets omitted by sanitized clients. */
export function mergeOAuthSettings(existing: any, incoming: any): any {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const result: Record<string, unknown> = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_KEYS.has(normalizedKey(key))) {
      if (value !== '' && value !== null && value !== undefined) result[key] = value;
    } else if (isPresenceFlag(key)) {
      continue;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeOAuthSettings(result[key], value);
    } else {
      result[key] = value;
    }
  }
  // Флаги наличия вычисляются на чтении и в базе не живут: сохранённый флаг рано или
  // поздно разойдётся с реальным секретом и снова начнёт врать пользователю.
  for (const key of Object.keys(result)) {
    if (isPresenceFlag(key)) delete result[key];
  }
  return result;
}
