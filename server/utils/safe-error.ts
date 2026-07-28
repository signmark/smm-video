export interface SafeErrorDetails {
  name: string;
  message: string;
  code?: string;
  status?: number;
}

const SENSITIVE_VALUE_PATTERN =
  /(password|passwd|secret|token|authorization|api[-_]?key)(\s*[=:]\s*)(["']?)[^\s,;&"']+\3/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// `key` без префикса — так передаёт ключ Gemini: сетевая ошибка node-fetch несёт
// полный URL, а роут отдавал её текст клиенту (находка ревью 2026-07-28).
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|refresh_token|token|password|secret|api[-_]?key|key|sig|signature|auth|code)=)[^&#\s]*/gi;

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(AUTH_HEADER_PATTERN, '$1 [REDACTED]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_VALUE_PATTERN, '$1$2[REDACTED]');
}

/**
 * Converts an arbitrary thrown value to a deliberately small, log-safe object.
 * Never copy the original error: Axios errors may contain credentials in config.data.
 */
export function toSafeErrorDetails(error: unknown): SafeErrorDetails {
  if (!error || typeof error !== 'object') {
    return {
      name: 'Error',
      message: sanitizeErrorMessage(typeof error === 'string' ? error : 'Unknown error'),
    };
  }

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.response?.status ?? candidate.status;

  return {
    name: typeof candidate.name === 'string' ? candidate.name : 'Error',
    message: sanitizeErrorMessage(
      typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
    ),
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    ...(typeof status === 'number' ? { status } : {}),
  };
}
