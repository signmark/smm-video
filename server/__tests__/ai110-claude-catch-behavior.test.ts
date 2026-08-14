/**
 * AI-110 follow-up (task #107): поведенческий тест Claude.
 *
 * Раньше при не-200 ответе в сообщение подставлялось `Response: ${JSON.stringify(response.data)}`,
 * и человек получал сырой JSON. Здесь настоящий путь ошибки выполняется целиком:
 * improveText перебирает модели, makeRequest делает попытки — и мы смотрим на
 * итоговую строку исключения, которая доходит до человека.
 *
 * Отдельно проверяем, что тело ответа Anthropic по-прежнему пишется в
 * диагностику сервера: из сообщения человеку оно убрано, из журнала — нет.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAxiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: any[]) => mockAxiosPost(...args),
    get: vi.fn(),
    isAxiosError: (e: any) => Boolean(e?.isAxiosError),
  },
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../services/api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn(async () => null) },
  ApiServiceName: {},
}));

vi.mock('../services/global-api-keys', () => ({
  GlobalApiKeysService: class {
    async getApiKey() {
      return null;
    }
  },
}));

function assertHumanReadable(message: string | undefined) {
  expect(message).toBeTruthy();
  expect(message).not.toBe('');
  expect(message).not.toContain('[object Object]');
  expect(message).not.toContain('{');
  expect(message).not.toContain('}');
}

/** Гоняем improveText под фейковыми таймерами: между попытками есть паузы. */
async function runImproveText(): Promise<any> {
  const { ClaudeService } = await import('../services/claude');
  const service = new ClaudeService('test-api-key');
  vi.useFakeTimers();
  const pending = service.improveText({ text: 'исходный текст', prompt: 'улучши' }).catch((e: any) => e);
  await vi.runAllTimersAsync();
  return pending;
}

describe('AI-110 follow-up: Claude — текст отказа для человека', () => {
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
    vi.resetModules();
  });

  it('Anthropic ответил 400 с телом ошибки → сообщение без raw JSON, тело в диагностике', async () => {
    mockAxiosPost.mockResolvedValue({
      status: 400,
      data: { error: { type: 'invalid_request_error', message: 'max_tokens is too large' } },
      headers: {},
    });

    const error = await runImproveText();

    expect(error).toBeInstanceOf(Error);
    assertHumanReadable(error.message);
    expect(error.message).toContain('status code 400');

    // Тело ответа не потеряно — оно ушло в сетевую диагностику.
    const printed = consoleSpy.mock.calls.map((c: any[]) => c.map(String).join(' ')).join('\n');
    expect(printed).toContain('max_tokens is too large');
  });

  it('Anthropic ответил 401 → «Invalid API key», без raw JSON', async () => {
    mockAxiosPost.mockResolvedValue({
      status: 401,
      data: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      headers: {},
    });

    const error = await runImproveText();

    expect(error).toBeInstanceOf(Error);
    assertHumanReadable(error.message);
    expect(error.message).toContain('Invalid API key');
  });

  it('Anthropic отклонил запрос с читаемым текстом → человек видит именно текст', async () => {
    const axiosError: any = new Error('Request failed with status code 400');
    axiosError.isAxiosError = true;
    axiosError.response = {
      status: 400,
      data: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
    };
    mockAxiosPost.mockRejectedValue(axiosError);

    const { ClaudeService } = await import('../services/claude');
    const service = new ClaudeService('test-api-key');
    const error = await service
      .improveText({ text: 'исходный текст', prompt: 'улучши' })
      .then(() => null)
      .catch((e: any) => e);

    expect(error).toBeInstanceOf(Error);
    assertHumanReadable(error.message);
    expect(error.message).toContain('Your credit balance is too low');
  });
});
