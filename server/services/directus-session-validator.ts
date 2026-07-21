import { createHash } from 'node:crypto';

export type DirectusSessionValidation = 'valid' | 'invalid' | 'unavailable';

const validationCache = new Map<string, { result: DirectusSessionValidation; expiresAt: number }>();
const inFlightValidations = new Map<string, Promise<DirectusSessionValidation>>();
const VALIDATION_CACHE_TTL_MS = 30_000;
const VALIDATION_TIMEOUT_MS = 3_000;
const MAX_CACHE_ENTRIES = 1000;

const metrics = { valid: 0, invalid: 0, unavailable: 0, upstreamRequests: 0, totalLatencyMs: 0 };

function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function isExplicitInvalid403(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = await response.clone().json() as any;
    const code = String(body?.errors?.[0]?.extensions?.code || body?.code || '').toUpperCase();
    return code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN';
  } catch {
    return false;
  }
}

async function validateUpstream(token: string, fetchImpl: typeof fetch): Promise<DirectusSessionValidation> {
  const directusUrl = (process.env.DIRECTUS_URL || 'https://directus.nplanner.ru').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  const startedAt = Date.now();
  metrics.upstreamRequests += 1;

  try {
    const response = await fetchImpl(`${directusUrl}/users/me?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (response.ok) return 'valid';
    if (response.status === 401 || await isExplicitInvalid403(response)) return 'invalid';
    return 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timeout);
    metrics.totalLatencyMs += Date.now() - startedAt;
  }
}

export async function validateDirectusSession(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectusSessionValidation> {
  const fingerprint = tokenFingerprint(token);
  const cached = validationCache.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) validationCache.delete(fingerprint);

  const existing = inFlightValidations.get(fingerprint);
  if (existing) return existing;

  const validation = validateUpstream(token, fetchImpl).then((result) => {
    metrics[result] += 1;
    if (result !== 'unavailable') {
      if (validationCache.size >= MAX_CACHE_ENTRIES) {
        validationCache.delete(validationCache.keys().next().value as string);
      }
      validationCache.set(fingerprint, { result, expiresAt: Date.now() + VALIDATION_CACHE_TTL_MS });
    }
    return result;
  }).finally(() => {
    inFlightValidations.delete(fingerprint);
  });

  inFlightValidations.set(fingerprint, validation);
  return validation;
}

export function getDirectusSessionValidationMetrics() {
  return {
    ...metrics,
    averageLatencyMs: metrics.upstreamRequests ? metrics.totalLatencyMs / metrics.upstreamRequests : 0,
  };
}

export function resetDirectusSessionValidatorForTests(): void {
  validationCache.clear();
  inFlightValidations.clear();
  metrics.valid = 0;
  metrics.invalid = 0;
  metrics.unavailable = 0;
  metrics.upstreamRequests = 0;
  metrics.totalLatencyMs = 0;
}
