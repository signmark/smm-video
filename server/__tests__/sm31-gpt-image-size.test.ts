/**
 * SM-31: выбранный размер изображения игнорировался при генерации.
 *
 * ЧТО БЫЛО. Человек выбирал 768×1024 (портрет), а получал 4:3 горизонтально —
 * при любом выборе. Причина не в fal и не в модели: мы слали в fal-эндпоинт
 * openai/gpt-image-2 поля OpenAI — `size` и `n`. У этого эндпоинта таких полей
 * нет. Неизвестные поля fal молча отбрасывает и берёт свой дефолт
 * `image_size = landscape_4_3`. Ровно его человек и видел.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Поведение целиком: настоящий вызов клиента с подменённым
 * транспортом fal, и в перехваченном запросе видно ровно то, что уйдёт в fal.
 * Формат сверен со схемой fal 2026-08-18.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { subscribeMock, configMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  configMock: vi.fn(),
}));

vi.mock('@fal-ai/client', () => ({
  fal: { config: configMock, subscribe: subscribeMock },
}));

import { falAiOfficialClient } from '../services/fal-ai-official-client';
import { resolveSizeParams } from '../services/fal-size-params';

/** Тело запроса, ушедшее в fal при последнем вызове. */
const sentInput = () => subscribeMock.mock.calls[0][1].input as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  subscribeMock.mockResolvedValue({ data: { images: [{ url: 'https://fal/out.png' }] } });
});

const generate = (extra: Record<string, any>) =>
  falAiOfficialClient.generateImages({
    model: 'openai/gpt-image-2',
    token: 'test-key',
    prompt: 'кот в скафандре',
    ...extra,
  } as any);

describe('SM-31: gpt-image через fal получает размер в поле, которое понимает', () => {
  it('портрет остаётся портретом', async () => {
    await generate({ width: 768, height: 1024 });

    // Человек выбрал 768×1024. Модель умеет только три размера, поэтому
    // отправляем ближайший по ориентации — но именно портрет, а не 4:3.
    expect(sentInput().image_size).toEqual({ width: 1024, height: 1536 });
  });

  it('альбом остаётся альбомом', async () => {
    await generate({ width: 1024, height: 768 });

    expect(sentInput().image_size).toEqual({ width: 1536, height: 1024 });
  });

  it('квадрат остаётся квадратом', async () => {
    await generate({ width: 1024, height: 1024 });

    expect(sentInput().image_size).toEqual({ width: 1024, height: 1024 });
  });

  it('полей OpenAI, которых у fal нет, в запросе не остаётся', async () => {
    await generate({ width: 768, height: 1024, numImages: 2 });

    const input = sentInput();
    // Именно из-за них fal брал свой дефолт landscape_4_3 и терял выбор человека.
    expect(input).not.toHaveProperty('size');
    expect(input).not.toHaveProperty('n');
    expect(input.num_images).toBe(2);
  });

  it('качество модель понимает — его оставляем', async () => {
    await generate({ width: 1024, height: 1024, quality: 'high' });

    expect(sentInput().quality).toBe('high');
  });
});

describe('SM-31: размер живёт в общем маппинге, а не в отдельной ветке клиента', () => {
  it('маппинг знает gpt-image', () => {
    // Раньше ветка gpt-image была написана мимо общего маппинга — по документации
    // OpenAI, а не fal. Из-за этого её никто не сверял со схемой fal.
    expect(resolveSizeParams('openai/gpt-image-2', 768, 1024))
      .toEqual({ image_size: { width: 1024, height: 1536 } });
    expect(resolveSizeParams('fal-ai/gpt-image-2', 1920, 1080))
      .toEqual({ image_size: { width: 1536, height: 1024 } });
  });

  it('остальные модели не задеты', () => {
    // Формы сверены со схемой fal 2026-08-18: у каждой модели своё поле.
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 768, 1024).aspect_ratio).toBe('3:4');
    expect(resolveSizeParams('fal-ai/fooocus', 1024, 768)).toEqual({ aspect_ratio: '1024x768' });
    expect(resolveSizeParams('fal-ai/fast-sdxl', 768, 1024))
      .toEqual({ image_size: { width: 768, height: 1024 } });
  });
});
