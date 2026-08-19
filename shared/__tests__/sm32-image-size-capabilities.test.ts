import { describe, expect, it } from 'vitest';
import {
  GPT_IMAGE_SIZES,
  getSizeCapability,
  nearestAllowedSize,
  ratioOf,
  resolveSizeSelection,
  sizeNoteForModel,
  sizeOptionsForModel,
  type ImageSizeOption,
} from '@shared/image-size-capabilities';
import { resolveSizeParams } from '../../server/services/fal-size-params';

/**
 * SM-32. Список размеров обязан отражать возможности выбранной модели.
 *
 * Дефект: список был один на все модели. Человек выбирал 768x1024, gpt-image-2
 * таких размеров не умеет вовсе, и мы молча отдавали 1024x1536 — ориентация
 * верная, числа другие, и нигде об этом ни слова.
 */

/** Общий список интерфейса — те же пять вариантов, что видит человек. */
const BASE: ImageSizeOption[] = [
  { width: 1024, height: 1024, label: '1024x1024 (Квадрат)' },
  { width: 1024, height: 768, label: '1024x768 (Альбомная)' },
  { width: 768, height: 1024, label: '768x1024 (Портретная)' },
  { width: 1024, height: 576, label: '1024x576 (Широкоэкранная)' },
  { width: 576, height: 1024, label: '576x1024 (Мобильная)' },
];

describe('SM-32: три размера у gpt-image-2', () => {
  it('в списке ровно три варианта модели, и ничего сверх них', () => {
    for (const id of ['fal-ai/gpt-image-2', 'openai/gpt-image-2', 'gpt-image-1']) {
      const options = sizeOptionsForModel(id, BASE);
      expect(options.map((o) => `${o.width}x${o.height}`)).toEqual([
        '1024x1024', '1536x1024', '1024x1536',
      ]);
    }
  });

  it('запрошенных 768x1024 в списке нет — именно их человек и выбирал', () => {
    const options = sizeOptionsForModel('fal-ai/gpt-image-2', BASE);
    expect(options.some((o) => o.width === 768 && o.height === 1024)).toBe(false);
  });

  it('под полем сказано словами, почему вариантов только три', () => {
    expect(sizeNoteForModel('fal-ai/gpt-image-2')).toContain('три размера');
  });
});

describe('SM-32: модели с произвольными размерами не задеты', () => {
  it('общий список остаётся как был', () => {
    for (const id of ['schnell', 'fal-ai/fast-sdxl', 'flux/juggernaut-xl-lora', 'fooocus', 'gemini']) {
      expect(sizeOptionsForModel(id, BASE)).toEqual(BASE);
    }
  });

  it('подписи про ограничение нет, потому что ограничения нет', () => {
    expect(sizeNoteForModel('schnell')).toBe('');
  });

  it('незнакомая модель считается свободной, а не сужается по догадке', () => {
    expect(getSizeCapability('какая-то-новая-модель').kind).toBe('free');
    expect(sizeOptionsForModel('какая-то-новая-модель', BASE)).toEqual(BASE);
  });
});

describe('SM-32: модель с соотношениями сторон', () => {
  it('оставляет только поддерживаемые соотношения', () => {
    const withUnsupported: ImageSizeOption[] = [
      ...BASE,
      { width: 1024, height: 448, label: '1024x448 (нет у модели)' }, // 16:7
    ];
    const options = sizeOptionsForModel('fal-ai/nano-banana-pro', withUnsupported);
    expect(options.map(ratioOf)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16']);
  });

  it('говорит, что размер задаётся соотношением, а не пикселями', () => {
    expect(sizeNoteForModel('fal-ai/nano-banana-pro')).toContain('соотношением сторон');
  });

  it('не оставляет пустой список, если общий список не пересёкся с возможностями', () => {
    const exotic: ImageSizeOption[] = [{ width: 1024, height: 448, label: '16:7' }];
    expect(sizeOptionsForModel('fal-ai/nano-banana-pro', exotic)).toEqual(exotic);
  });
});

describe('SM-32: смена модели не оставляет недопустимый размер', () => {
  it('портрет заменяется портретом, и замена объявлена', () => {
    const result = resolveSizeSelection('fal-ai/gpt-image-2', { width: 768, height: 1024 }, BASE);
    expect(result.selected).toEqual(GPT_IMAGE_SIZES[2]);
    expect(result.replaced).toBe(true);
    expect(result.note).not.toBe('');
  });

  it('альбомный остаётся альбомным', () => {
    const result = resolveSizeSelection('fal-ai/gpt-image-2', { width: 1024, height: 576 }, BASE);
    expect(result.selected).toEqual(GPT_IMAGE_SIZES[1]);
    expect(result.replaced).toBe(true);
  });

  it('допустимый размер не трогается и о замене не сообщается', () => {
    const result = resolveSizeSelection('fal-ai/gpt-image-2', { width: 1024, height: 1024 }, BASE);
    expect(result.selected).toEqual(GPT_IMAGE_SIZES[0]);
    expect(result.replaced).toBe(false);
  });

  it('у свободной модели выбор человека сохраняется как есть', () => {
    const result = resolveSizeSelection('schnell', { width: 768, height: 1024 }, BASE);
    expect(result.replaced).toBe(false);
    expect(result.selected.width).toBe(768);
  });

  it('ближайший ищется по соотношению внутри своей ориентации', () => {
    // 1024x600 — почти 16:9; из альбомных вариантов ближе 1024x576, а не 1024x768.
    const nearest = nearestAllowedSize('schnell', { width: 1024, height: 600 }, BASE);
    expect(`${nearest.width}x${nearest.height}`).toBe('1024x576');
  });
});

describe('SM-32: сервер и интерфейс берут возможности из одного места', () => {
  it('сервер отдаёт fal ровно тот размер, который предлагает список', () => {
    const options = sizeOptionsForModel('fal-ai/gpt-image-2', BASE);
    for (const option of options) {
      expect(resolveSizeParams('fal-ai/gpt-image-2', option.width, option.height)).toEqual({
        image_size: { width: option.width, height: option.height },
      });
    }
  });

  it('старый запрос с размером, которого модель не умеет, по-прежнему приводится к допустимому', () => {
    // Автономный режим и сохранённые задания приходят с любыми числами — сервер
    // остаётся последней линией, даже когда интерфейс уже не даёт их выбрать.
    expect(resolveSizeParams('fal-ai/gpt-image-2', 768, 1024)).toEqual({
      image_size: { width: 1024, height: 1536 },
    });
  });

  it('соотношения nano-banana сервер берёт из общего перечня', () => {
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 1024, 576)).toEqual({
      aspect_ratio: '16:9',
      resolution: '1K',
    });
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 768, 1024)).toEqual({
      aspect_ratio: '3:4',
      resolution: '1K',
    });
  });
});
