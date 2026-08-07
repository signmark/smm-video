/**
 * Утилиты для работы с URL
 */
import { log } from './logger';

export function normalizeSourceUrl(url: string | null | undefined, domain: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if(parsed.hostname === domain){
      return url;
    }
    return undefined;
  } catch(e){
    log.error('Error normalizing source URL', url, e);
    return undefined;
  }
}
