/**
 * AI-110 follow-up (task #107): поведенческий тест Instagram Stories.
 *
 * Прогоняем настоящий путь публикации до отказа Graph API и смотрим на строку,
 * которая уйдёт человеку: без raw JSON, без [object Object], не пустая.
 * Отдельно закрыт случай, ради которого всё и затевалось: Facebook вернул
 * объект ошибки БЕЗ поля message — тогда человеку не должно достаться
 * [object Object], а тело ответа обязано остаться в журнале сервера.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args),
    post: (...args: any[]) => mockAxiosPost(...args),
    isAxiosError: (e: any) => Boolean(e?.isAxiosError),
  },
}));

const mockLog = vi.fn();
vi.mock('../utils/logger', () => ({
  log: (...args: any[]) => mockLog(...args),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

/** Контент, кампания и username отвечают нормально — падать должен Graph API. */
function armHappyPathUntilContainer() {
  mockAxiosGet.mockImplementation((url: string) => {
    if (url.includes('campaign_content')) {
      return Promise.resolve({
        data: { data: { id: 'content-1', campaign_id: 'camp-1', image_url: 'https://cdn.example.com/i.jpg' } },
      });
    }
    if (url.includes('user_campaigns')) {
      return Promise.resolve({
        data: { data: { social_media_settings: { instagram: { token: 'ig-token', accountId: 'acc-1' } } } },
      });
    }
    // запрос username и опрос статуса контейнера
    return Promise.resolve({ data: { username: 'test_account', status_code: 'FINISHED' } });
  });
}

function loggedText(): string {
  return mockLog.mock.calls.map((c) => String(c[0])).join('\n');
}

function assertHumanReadable(message: string | undefined) {
  expect(message).toBeTruthy();
  expect(message).not.toBe('');
  expect(message).not.toContain('[object Object]');
  expect(message).not.toContain('{');
  expect(message).not.toContain('}');
}

describe('AI-110 follow-up: Instagram Stories — текст отказа для человека', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armHappyPathUntilContainer();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('создание контейнера вернуло ответ без id → причина без raw JSON, тело в журнале', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { debug_info: 'media container quota exceeded', trace_id: 'ABC123' } });

    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const result = await publishInstagramStory('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('создания контейнера');
    expect(loggedText()).toContain('media container quota exceeded');
  });

  it('Graph API отклонил создание контейнера с текстом ошибки → текст показан человеку', async () => {
    const axiosError: any = new Error('Request failed with status code 400');
    axiosError.isAxiosError = true;
    axiosError.response = {
      status: 400,
      data: { error: { message: 'Media type STORIES is not supported for this account', code: 100 } },
    };
    mockAxiosPost.mockRejectedValueOnce(axiosError);

    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const result = await publishInstagramStory('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('Media type STORIES is not supported');
  });

  it('Graph API вернул объект ошибки БЕЗ message → не [object Object], а понятный отказ', async () => {
    const axiosError: any = new Error('Request failed with status code 400');
    axiosError.isAxiosError = true;
    axiosError.response = { status: 400, data: { error: { code: 190, type: 'OAuthException' } } };
    mockAxiosPost.mockRejectedValueOnce(axiosError);

    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const result = await publishInstagramStory('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    // Причина без текста должна называть код, а не растворяться в общей фразе.
    expect(result.error).toContain('код 190');
  });

  it('публикация готового контейнера вернула ответ без id → причина без raw JSON', async () => {
    // 1) контейнер создан, 2) публикация вернула тело без id
    mockAxiosPost
      .mockResolvedValueOnce({ data: { id: 'container-1' } })
      .mockResolvedValueOnce({ data: { debug_info: 'publish rate limit', trace_id: 'XYZ789' } });

    vi.useFakeTimers();
    const { publishInstagramStory } = await import('../services/social-platforms/instagram-stories-service');
    const pending = publishInstagramStory('content-1', 'admin-token');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('публикации');
    expect(loggedText()).toContain('publish rate limit');
  });
});
