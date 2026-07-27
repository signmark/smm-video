/**
 * Provider webhooks keep their endpoint-specific verification/limiting rules.
 * VK token-webhook control routes are authenticated application endpoints and
 * must not inherit the broad "/webhook" exemption merely because of their name.
 */
export function shouldSkipGlobalApiRateLimit(requestPath: string): boolean {
  return requestPath.includes('/webhook')
    && !requestPath.includes('/vk/token-webhook/');
}
