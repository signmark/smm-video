/**
 * Helper function to normalize Instagram URLs
 */
export function normalizeInstagramUrl(url: string): string {
  try {
    // Remove http/https and www
    let username = url.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '');

    // Remove @ if present
    if (username.startsWith('@')) {
      username = username.substring(1);
    }

    // Remove trailing slash and query params
    username = username.split('/')[0].split('?')[0];

    if (!username) return '';

    return `https://instagram.com/${username}`;
  } catch (error) {
    log.error(`Error normalizing Instagram URL ${url}:`, error);
    return url;
  }
}

/**
 * Helper function to add delay between requests
 */
import { log } from './logger';
export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
