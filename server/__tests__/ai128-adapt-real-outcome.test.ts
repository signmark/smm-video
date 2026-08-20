/**
 * SM-35 (продолжение AI-128). Раньше маршрут /api/content/:id/adapt отправлял
 * задание в n8n, а n8n из продукта выведен: AI-128 сделала отказ честным, но
 * сохранения не было вовсе. Теперь тексты сохраняются своими силами, и сторожить
 * надо другое.
 *
 * Первое: успех объявляется только ПОСЛЕ записи, а не до неё.
 * Второе: в маршруте не осталось похода в n8n — иначе мы вернём тот же дефект
 * другим путём.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '../routes/content.ts'), 'utf-8');
const routeStart = src.indexOf('app.post("/api/content/:id/adapt"');
const routeBody = src.slice(routeStart, src.indexOf('// Клонирование контента', routeStart));

describe('SM-35: маршрут адаптации сохраняет сам', () => {
  it('маршрут на месте', () => {
    expect(routeStart).toBeGreaterThan(0);
    expect(routeBody.length).toBeGreaterThan(0);
  });

  it('в маршруте не осталось похода в n8n', () => {
    expect(routeBody).not.toContain('N8N_URL');
    expect(routeBody).not.toContain('X-N8N-Authorization');
    expect(routeBody).not.toContain('webhook/0b4d5ad4');
  });

  it('пишем слияние, а не присланный объект целиком', () => {
    expect(routeBody).toContain('mergeAdaptedPlatforms(content.social_platforms, socialPlatforms)');
    expect(routeBody).not.toContain('social_platforms: socialPlatforms');
  });

  it('успех объявляется после записи, а не до неё', () => {
    const write = routeBody.indexOf('directusApi.patch');
    const success = routeBody.indexOf('success: true');
    expect(write).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(write);
  });

  it('пустой набор текстов — это отказ, а не тихий успех', () => {
    expect(routeBody).toContain('if (!merged.saved.length)');
    expect(routeBody).toContain('status(400)');
  });

  it('кэш списка сбрасывается, иначе человек увидит старый текст', () => {
    expect(routeBody).toContain('invalidateContentCache(userId, content.campaign_id)');
  });
});
