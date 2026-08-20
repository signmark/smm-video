/**
 * AI-110 follow-up (task #107): поведенческий тест YouTube.
 *
 * Хранитель исходников (ai110-raw-json-guard) доказывает, что строка с
 * JSON.stringify исчезла из throw. Он НЕ доказывает, что человек получил
 * понятную причину: путь ошибки при этом не выполняется. Здесь путь
 * выполняется по-настоящему — publishShort/publishVideo доходят до отказа
 * YouTube, и мы смотрим на ту самую строку, которая уйдёт в карточку контента.
 *
 * Проверяем три вещи разом:
 *   1) в сообщении нет фигурных скобок (raw JSON),
 *   2) нет [object Object],
 *   3) строка не пустая и называет причину.
 * Плюс: тело ответа YouTube по-прежнему попадает в журнал сервера — иначе на
 * проде было бы не понять, что именно вернул YouTube.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();
const mockAxiosPut = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args),
    post: (...args: any[]) => mockAxiosPost(...args),
    put: (...args: any[]) => mockAxiosPut(...args),
    isAxiosError: (e: any) => Boolean(e?.isAxiosError),
  },
}));

const mockDirectusGet = vi.fn();
const mockDirectusPatch = vi.fn();
vi.mock('../directus', () => ({
  directusApi: {
    get: (...args: any[]) => mockDirectusGet(...args),
    patch: (...args: any[]) => mockDirectusPatch(...args),
  },
}));

const mockLog = vi.fn();
vi.mock('../utils/logger', () => ({
  log: Object.assign((...args: any[]) => mockLog(...args), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../services/youtube-token-refresh', () => ({
  YouTubeTokenRefresh: class {
    async refreshAccessToken() {
      return { accessToken: 'refreshed-token' };
    }
  },
}));

/** Контент и настройки кампании валидны — отказ должен прийти именно от YouTube. */
function armHappyPathUntilUpload() {
  mockDirectusGet.mockImplementation((url: string) => {
    if (url.includes('campaign_content')) {
      return Promise.resolve({
        data: {
          data: {
            id: 'content-1',
            campaign_id: 'camp-1',
            title: 'Ролик',
            content: 'Описание ролика',
            video_url: 'https://cdn.example.com/v.mp4',
          },
        },
      });
    }
    if (url.includes('user_campaigns')) {
      return Promise.resolve({
        data: { data: { social_settings: { youtube: { accessToken: 'yt-token' } } } },
      });
    }
    return Promise.reject(new Error(`unexpected directus url: ${url}`));
  });
  // скачивание видео
  mockAxiosGet.mockResolvedValue({ data: Buffer.from('fake-video-bytes') });
}

/** Всё, что дошло в журнал сервера, одной строкой. */
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

describe('AI-110 follow-up: YouTube Shorts — текст отказа для человека', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armHappyPathUntilUpload();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('YouTube принял загрузку, но не вернул id видео → причина без raw JSON', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      headers: { location: 'https://upload.googleapis.com/resumable/1' },
      data: {},
    });
    // Реальная форма отказа: 200 с телом-ошибкой вместо id.
    mockAxiosPut.mockResolvedValueOnce({
      data: { error: { code: 403, message: 'The user has exceeded the number of videos they may upload.' } },
    });

    const { YouTubeShortsService } = await import('../services/social-platforms/youtube-shorts-service');
    const result = await new YouTubeShortsService().publishShort('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('ID видео');

    // Диагностика не потеряна: тело ответа ушло в журнал сервера.
    expect(loggedText()).toContain('exceeded the number of videos');
  });

  it('YouTube не вернул upload URI → причина без raw JSON, тело в журнале', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      headers: {},
      data: { error: { code: 403, message: 'Insufficient Permission' } },
    });

    const { YouTubeShortsService } = await import('../services/social-platforms/youtube-shorts-service');
    const result = await new YouTubeShortsService().publishShort('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('upload URI');
    expect(loggedText()).toContain('Insufficient Permission');
  });

  it('отказ приходит объектом без текста → человек видит статус, а не [object Object]', async () => {
    const axiosError: any = new Error('Request failed with status code 401');
    axiosError.isAxiosError = true;
    axiosError.response = { status: 401, data: { error: { code: 401 } } };
    mockAxiosPost.mockRejectedValueOnce(axiosError);

    const { YouTubeShortsService } = await import('../services/social-platforms/youtube-shorts-service');
    const result = await new YouTubeShortsService().publishShort('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('401');
  });
});

describe('AI-110 follow-up: YouTube Video — текст отказа для человека', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    armHappyPathUntilUpload();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('YouTube не вернул id видео → причина без raw JSON, тело в журнале', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      headers: { location: 'https://upload.googleapis.com/resumable/2' },
      data: {},
    });
    mockAxiosPut.mockResolvedValueOnce({
      data: { error: { code: 400, message: 'Invalid video metadata supplied.' } },
    });

    const { YouTubeVideoService } = await import('../services/social-platforms/youtube-video-service');
    const result = await new YouTubeVideoService().publishVideo('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('ID видео');
    expect(loggedText()).toContain('Invalid video metadata');
  });

  it('YouTube не вернул upload URI → причина без raw JSON', async () => {
    mockAxiosPost.mockResolvedValueOnce({ headers: {}, data: { error: { message: 'Login Required' } } });

    const { YouTubeVideoService } = await import('../services/social-platforms/youtube-video-service');
    const result = await new YouTubeVideoService().publishVideo('content-1', 'admin-token');

    expect(result.success).toBe(false);
    assertHumanReadable(result.error);
    expect(result.error).toContain('upload URI');
    expect(loggedText()).toContain('Login Required');
  });
});
