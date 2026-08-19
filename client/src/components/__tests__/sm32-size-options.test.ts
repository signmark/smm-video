/**
 * SM-32: диалог генерации берёт список размеров из общего описания
 * возможностей модели, а не из своего списка на все случаи.
 *
 * ВНИМАНИЕ (правило 49). Это сканер исходника: поведение самого списка закрыто
 * поведенческими тестами в shared/__tests__/sm32-image-size-capabilities.test.ts
 * (17 случаев). Здесь стережётся только место сшивки — что диалог не вернулся к
 * общему списку и что смена модели снова не станет молчаливой.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function dialog(): string {
  return readFileSync(join(__dirname, '../ImageGenerationDialog.tsx'), 'utf-8');
}

describe('SM-32: список размеров строится по выбранной модели', () => {
  it('поле «Размер» перебирает варианты модели, а не общий список', () => {
    const s = dialog();
    const idx = s.indexOf('placeholder="Выберите размер"');
    expect(idx).toBeGreaterThan(0);

    const select = s.slice(idx, idx + 900);
    expect(select).toContain('sizeSelection.options.map');
    expect(select).not.toContain('ASPECT_RATIOS.map');
  });

  it('ограничение модели названо словами рядом с полем', () => {
    const s = dialog();
    expect(s).toContain('data-testid="image-size-note"');
    expect(s).toContain('sizeSelection.note');
  });

  it('смена модели пересчитывает размер и сообщает о замене', () => {
    const s = dialog();
    const idx = s.indexOf('setModelType(value)');
    expect(idx).toBeGreaterThan(0);

    const handler = s.slice(idx, idx + 900);
    expect(handler).toContain('resolveSizeSelection');
    expect(handler).toContain('setImageSize');
    // Молчаливая подмена и была дефектом: замена обязана дойти до человека.
    expect(handler).toContain('toast(');
  });
});
