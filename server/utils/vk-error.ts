/**
 * Minimal typed VK API error pattern for throw sites.
 * Avoids raw JSON in error messages while preserving operation context.
 */

export interface VkApiError {
  error_msg?: string;
  error_code?: number;
  message?: string;
}

/** Typed enrichment for VK errors — replaces `any` at throw sites. */
export interface VkEnrichedError extends Error {
  code?: number;
  response: { data: unknown; status?: number };
}

/** Type-guard: distinguishes our enrichment from axios/other errors. */
export function isVkEnrichedError(err: unknown): err is VkEnrichedError {
  return (
    err instanceof Error &&
    typeof (err as any).code === 'number' &&
    (err as any).response !== undefined
  );
}

/**
 * Extract human-readable error message from VK API response.
 * Falls back to operation context if no message available.
 */
export function formatVkErrorMessage(operation: string, error: VkApiError): string {
  const msg = error.error_msg || error.message || 'Unknown VK error';
  return `${operation}: ${msg}`;
}

/** Factory: creates a typed enriched VK error (replaces `const e: any` pattern). */
export function createVkApiError(
  operation: string,
  vkError: VkApiError,
  responseData: unknown,
  responseStatus?: number
): VkEnrichedError {
  const e = new Error(formatVkErrorMessage(operation, vkError)) as VkEnrichedError;
  e.code = vkError.error_code;
  e.response = { data: responseData, status: responseStatus };
  return e;
}
