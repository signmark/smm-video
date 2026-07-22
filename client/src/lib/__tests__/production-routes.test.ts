import { describe, expect, it } from 'vitest';
import { INTERNAL_ROUTE_PATTERNS, isInternalRoute } from '../production-routes';

describe('isInternalRoute', () => {
  it.each([
    '/test/auth-bypass',
    '/test/api-keys',
    '/test/fal-ai-test',
    '/test/image-generation',
    '/test/transparent-dialog',
    '/test/stories-generator',
    '/test/api-key-priority',
    '/test/universal-image-gen',
    '/test/time-display-test',
    '/test/error-handling',
    '/test/html-tags',
    '/test/telegram',
    '/test/ai-image',
    '/test/index',
    '/publish/test',
    '/editor-demo',
  ])('flags %s as internal', (path) => {
    expect(isInternalRoute(path)).toBe(true);
  });

  it.each([
    '/auth/login',
    '/auth/register',
    '/content',
    '/posts',
    '/analytics',
    '/publish/scheduled',
    '/publish/calendar',
    '/campaigns',
    '/campaigns/abc-123',
    '/dashboard',
    '/admin/users',
    '/help',
    '/help/tutorials',
    '/help/tutorials/intro',
    '/video',
    '/stories',
    '/stories/new',
    '/stories/abc/video-edit',
    '/',
    '',
  ])('does not flag %s as internal', (path) => {
    expect(isInternalRoute(path)).toBe(false);
  });

  it('keeps the production allowlist non-empty (catches accidental empties)', () => {
    expect(INTERNAL_ROUTE_PATTERNS.length).toBeGreaterThan(0);
  });
});
