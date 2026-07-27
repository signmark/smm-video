/**
 * resolveSizeParams — маппинг размера под параметр конкретной fal-модели.
 * Формы сверены с доками fal (см. сам модуль). Раньше во все модели слали
 * top-level width/height, который они игнорируют → размер не менялся.
 */
import { describe, it, expect } from 'vitest';
import { resolveSizeParams } from '../services/fal-size-params';

describe('resolveSizeParams', () => {
  it('schnell / fast-sdxl / flux-lora / juggernaut / дефолт → image_size:{width,height}', () => {
    for (const id of [
      'schnell', 'fal-ai/flux/schnell', 'fal-ai/fast-sdxl', 'fal-ai/flux-lora',
      'rundiffusion-fal/juggernaut-flux-lora', 'rundiffusion-fal/juggernaut-flux/lightning',
      'fal-ai/juggernaut-xl-v9', 'some-future-model',
    ]) {
      const p = resolveSizeParams(id, 1024, 768);
      expect(p).toEqual({ image_size: { width: 1024, height: 768 } });
      expect(p.width).toBeUndefined();
      expect(p.height).toBeUndefined();
    }
  });

  it('fooocus → aspect_ratio "WxH"', () => {
    expect(resolveSizeParams('fal-ai/fooocus', 1024, 768)).toEqual({ aspect_ratio: '1024x768' });
    expect(resolveSizeParams('fooocus', 1024, 1024)).toEqual({ aspect_ratio: '1024x1024' });
  });

  it('nano-banana-pro → aspect_ratio (ближайший) + resolution, без image_size', () => {
    const p = resolveSizeParams('fal-ai/nano-banana-pro', 1024, 1024);
    expect(p).toEqual({ aspect_ratio: '1:1', resolution: '1K' });
    expect(p.image_size).toBeUndefined();
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 1920, 1080).aspect_ratio).toBe('16:9');
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 768, 1024).aspect_ratio).toBe('3:4');
  });

  it('resolution растёт с размером', () => {
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 1024, 1024).resolution).toBe('1K');
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 2048, 2048).resolution).toBe('2K');
    expect(resolveSizeParams('fal-ai/nano-banana-pro', 4096, 4096).resolution).toBe('4K');
  });

  it('размеры округляются до кратных 8', () => {
    expect(resolveSizeParams('fal-ai/fast-sdxl', 1020, 770)).toEqual({ image_size: { width: 1024, height: 768 } });
  });

  it('без размеров → дефолт 1024x1024', () => {
    expect(resolveSizeParams('fal-ai/fast-sdxl')).toEqual({ image_size: { width: 1024, height: 1024 } });
  });
});
