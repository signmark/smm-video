/**
 * SM-15 / AI-91: confirmPublishRecord — хелпер для post-publish записи в Directus.
 *
 * ДЕФЕКТ. До AI-91 post-publish `axios.patch` в Directus не имел своего
 * try/catch в `social-publishing-router.ts`. Если Directus сбоил, пост уходил в
 * Telegram/Threads/VK/Facebook/Instagram/YouTube, а в БД оставалось
 * `status=draft, social_platforms={}` (пример поста 16, UUID 9bca60ba…).
 * Тестировщик видел пост в канале, но не видел в приложении (фильтр по
 * `status=published`), публиковал руками — получал дубль. Планировщик тоже мог
 * перепослать: Telegram sendMessage не идемпотентен.
 *
 * ФИКС. Хелпер `confirmPublishRecord` делает две попытки записи:
 *   1. `status: 'published'` — нормальный успех.
 *   2. Если первая провалилась — `status: 'publish_succeeded_record_failed'` с
 *      доказательствами публикации (postId/postUrl/publishedAt).
 * Возвращает дискриминированный union, не бросает.
 *
 * Mutation-proof: убрать вторую попытку (`attemptPatch(recordFailedPatch)`) →
 * тест на `markerSaved: true` краснеет. Это подтверждает, что защита работает.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  axiosPatch: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    patch: H.axiosPatch,
  },
}));

import {
  confirmPublishRecord,
  recordFailedResponse,
  type PlatformPublishedFields,
} from '../services/publish-record-confirm';

beforeEach(() => {
  H.axiosPatch.mockReset();
  process.env.DIRECTUS_URL = 'https://directus.test';
  process.env.DIRECTUS_STATIC_TOKEN = 'test-token';
});

describe('confirmPublishRecord — успешный путь', () => {
  it('возвращает kind: success если первая попытка patch прошла', async () => {
    H.axiosPatch.mockResolvedValueOnce({ data: { data: { id: 'c1' } } });

    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'tg-msg-1',
      postUrl: 'https://t.me/channel/1',
      publishedAt: '2026-07-30T22:00:00.000Z',
    };

    const out = await confirmPublishRecord({
      contentId: 'content-1',
      platform: 'telegram',
      currentSocialPlatforms: { telegram: { status: 'pending' } },
      published,
    });

    expect(out.kind).toBe('success');
    expect(H.axiosPatch).toHaveBeenCalledTimes(1);
    const [url, patch] = H.axiosPatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://directus.test/items/campaign_content/content-1');
    expect((patch.social_platforms as Record<string, unknown>).telegram).toEqual(published);
  });
});

describe('confirmPublishRecord — сбой первой попытки, успешный маркер', () => {
  it('возвращает record-failed и markerSaved: true если вторая попытка прошла', async () => {
    H.axiosPatch
      .mockRejectedValueOnce(new Error('Directus 503'))
      .mockResolvedValueOnce({ data: { data: { id: 'c1' } } });

    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'tg-msg-2',
      postUrl: 'https://t.me/channel/2',
      publishedAt: '2026-07-31T09:00:00.000Z',
    };

    const out = await confirmPublishRecord({
      contentId: 'content-2',
      platform: 'telegram',
      currentSocialPlatforms: {},
      published,
    });

    expect(out.kind).toBe('record-failed');
    if (out.kind !== 'record-failed') throw new Error('expected record-failed');
    expect(out.markerSaved).toBe(true);
    expect(out.originalError).toContain('Directus 503');
    expect(H.axiosPatch).toHaveBeenCalledTimes(2);

    const markerCall = H.axiosPatch.mock.calls[1] as [string, Record<string, unknown>];
    const markerPlatform = (markerCall[1].social_platforms as Record<string, Record<string, unknown>>).telegram;
    expect(markerPlatform.status).toBe('publish_succeeded_record_failed');
    expect(markerPlatform.postId).toBe('tg-msg-2');
    expect(markerPlatform.originalError).toContain('Directus 503');
    expect(typeof markerPlatform.recordedAt).toBe('string');
  });

  it('сохраняет postId/postUrl/publishedAt в маркере (доказательства публикации)', async () => {
    H.axiosPatch
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { data: {} } });

    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'vk-post-99',
      postUrl: 'https://vk.com/wall-1_99',
      publishedAt: '2026-07-31T09:00:00.000Z',
    };

    const out = await confirmPublishRecord({
      contentId: 'content-3',
      platform: 'vk',
      currentSocialPlatforms: { telegram: { status: 'published' } },
      published,
    });

    expect(out.kind).toBe('record-failed');
    if (out.kind !== 'record-failed') throw new Error('expected record-failed');
    const markerCall = H.axiosPatch.mock.calls[1] as [string, Record<string, unknown>];
    const marker = (markerCall[1].social_platforms as Record<string, Record<string, unknown>>).vk;
    // postId/postUrl/publishedAt — доказательства того, что ОТПРАВКА прошла.
    expect(marker.postId).toBe('vk-post-99');
    expect(marker.postUrl).toBe('https://vk.com/wall-1_99');
    expect(marker.publishedAt).toBe('2026-07-31T09:00:00.000Z');
    // status и есть тот самый новый статус.
    expect(marker.status).toBe('publish_succeeded_record_failed');
  });

  it('merge с currentSocialPlatforms — не затирает другие платформы', async () => {
    H.axiosPatch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: { data: {} } });

    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'p1',
      postUrl: 'u1',
      publishedAt: '2026-07-30T22:00:00.000Z',
    };

    await confirmPublishRecord({
      contentId: 'content-4',
      platform: 'threads',
      currentSocialPlatforms: {
        telegram: { status: 'published', postId: 'tg-prev' },
        facebook: { status: 'pending' },
      },
      published,
    });

    const markerCall = H.axiosPatch.mock.calls[1] as [string, Record<string, unknown>];
    const sp = markerCall[1].social_platforms as Record<string, Record<string, unknown>>;
    // threads — наш новый маркер
    expect(sp.threads.status).toBe('publish_succeeded_record_failed');
    // telegram — сохранён, не затёрт
    expect(sp.telegram).toEqual({ status: 'published', postId: 'tg-prev' });
    // facebook — сохранён
    expect(sp.facebook).toEqual({ status: 'pending' });
  });
});

describe('confirmPublishRecord — обе попытки упали', () => {
  it('возвращает markerSaved: false и secondaryError', async () => {
    H.axiosPatch
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce(new Error('second fail'));

    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'p2',
      postUrl: 'u2',
      publishedAt: '2026-07-30T22:00:00.000Z',
    };

    const out = await confirmPublishRecord({
      contentId: 'content-5',
      platform: 'telegram',
      currentSocialPlatforms: {},
      published,
    });

    expect(out.kind).toBe('record-failed');
    if (out.kind !== 'record-failed') throw new Error('expected record-failed');
    expect(out.markerSaved).toBe(false);
    expect(out.originalError).toContain('first fail');
    expect(out.secondaryError).toContain('second fail');
    expect(H.axiosPatch).toHaveBeenCalledTimes(2);
  });
});

describe('recordFailedResponse — форма ответа для UI', () => {
  it('несёт оба факта: published: true и recordSaved: false', () => {
    const published: PlatformPublishedFields = {
      status: 'published',
      postId: 'p3',
      postUrl: 'u3',
      publishedAt: '2026-07-30T22:00:00.000Z',
    };
    const resp = recordFailedResponse({
      platform: 'telegram',
      published,
      outcome: {
        kind: 'record-failed',
        originalError: 'Directus 503',
        markerSaved: true,
      },
    });

    // КРИТИЧНО: success: true и published: true. Если вернём success: false,
    // пользователь решит «не опубликовано» и опубликует руками → дубль.
    expect(resp.success).toBe(true);
    expect(resp.published).toBe(true);
    expect(resp.recordSaved).toBe(false);
    expect(resp.guidance).toBe('do_not_republish');
    expect(resp.platform).toBe('telegram');
    expect(resp.postId).toBe('p3');
    expect(resp.postUrl).toBe('u3');
    expect(resp.recordError).toContain('Directus 503');
    expect(resp.markerSaved).toBe(true);
  });
});