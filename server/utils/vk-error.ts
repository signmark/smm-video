/**
 * Minimal typed VK API error pattern for throw sites.
 * Avoids raw JSON in error messages while preserving operation context.
 */

export interface VkApiError {
  error_msg?: string;
  error_code?: number;
  message?: string;
}

/**
 * Extract human-readable error message from VK API response.
 * Falls back to operation context if no message available.
 */
export function formatVkErrorMessage(operation: string, error: VkApiError): string {
  const msg = error.error_msg || error.message || 'Unknown VK error';
  return `${operation}: ${msg}`;
}
