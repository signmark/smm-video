/**
 * Production route allowlist for /test/* and other internal pages.
 *
 * Centralising the list here means a Playwright test or a unit test can
 * verify that no internal page is reachable in a production build
 * without having to crawl the React tree. Any new diagnostic page
 * added under /test/* must be listed here so that it can be guarded in
 * the same way (see App.tsx).
 */
export const INTERNAL_ROUTE_PATTERNS: ReadonlyArray<string> = [
  '/test/',
  '/publish/test',
  '/editor-demo',
];

export function isInternalRoute(path: string): boolean {
  return INTERNAL_ROUTE_PATTERNS.some((pattern) => path.startsWith(pattern));
}
