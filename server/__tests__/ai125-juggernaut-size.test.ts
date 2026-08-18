/**
 * AI-125: fal-ai-juggernaut шлёт числовые размеры как image_width/image_height
 * (и top-level width/height у «других моделей»), которых у fal НЕТ — он молча
 * отбрасывает поле и берёт свой дефолт. Размер выбранный пользователем не
 * применялся. Перевод на resolveSizeParams → image_size:{width,height}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalAiJuggernautService } from '../services/fal-ai-juggernaut';

const mockPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...a: any[]) => mockPost(...a),
    get: vi.fn(),
    create: vi.fn().mockReturnValue({
      get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
      interceptors: { request: { use: vi.fn(), eject: vi.fn() }, response: { use: vi.fn(), eject: vi.fn() } },
    }),
  },
}));

vi.mock('./api-keys', () => ({
  apiKeyService: { getApiKey: vi.fn() },
}));

describe('AI-125: fal-ai-juggernaut шлёт image_size, а не image_width/image_height', () => {
  let svc: FalAiJuggernautService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new FalAiJuggernautService();
    svc.initialize('Key test-key');
    // Прямой ответ с картинками (не 202 async).
    mockPost.mockResolvedValue({ status: 200, data: { images: [{ url: 'https://x/y.png' }] } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('числовой размер у Juggernaut уходит в image_size:{width,height}, не в image_width/image_height', async () => {
    await svc.generateImages({
      model: 'rundiffusion-fal/juggernaut-flux-lora',
      prompt: 'test',
      width: 832,
      height: 1024,
    });

    const body = mockPost.mock.calls[0][1];
    expect(body.image_size).toEqual({ width: 832, height: 1024 });
    expect(body.image_width).toBeUndefined();
    expect(body.image_height).toBeUndefined();
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
  });

  it('дефолт без размеров тоже идёт image_size, не width/height', async () => {
    await svc.generateImages({
      model: 'rundiffusion-fal/juggernaut-flux/lightning',
      prompt: 'test',
    });

    const body = mockPost.mock.calls[0][1];
    expect(body.image_size).toEqual({ width: 1024, height: 1024 });
    expect(body.image_width).toBeUndefined();
    expect(body.width).toBeUndefined();
  });

  it('строковый imageSize остаётся enum-строкой (fal понимает)', async () => {
    await svc.generateImages({
      model: 'rundiffusion-fal/juggernaut-flux-lora',
      prompt: 'test',
      imageSize: 'landscape_4_3',
    });

    const body = mockPost.mock.calls[0][1];
    expect(body.image_size).toBe('landscape_4_3');
  });

  it('у «других моделей» (non-schnell) размер тоже image_size, не width/height', async () => {
    await svc.generateImages({
      model: 'fal-ai/blah',
      prompt: 'test',
      width: 768,
      height: 1152,
    });

    const body = mockPost.mock.calls[0][1];
    expect(body.image_size).toEqual({ width: 768, height: 1152 });
    expect(body.width).toBeUndefined();
    expect(body.height).toBeUndefined();
  });
});
