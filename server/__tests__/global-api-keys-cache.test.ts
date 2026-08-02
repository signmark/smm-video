/**
 * Рантайм-кеш глобальных API-ключей (AI-66).
 *
 * Кешей два: `keysCache` — список для админки, `keyCache` — то, из чего реально
 * берут ключ работающие сервисы. Обновление ключа правило только список, а
 * рантайм до часа продолжал отдавать прежнее значение: пользователь менял ключ
 * Qwen и не понимал, почему ничего не изменилось.
 *
 * Тесты идут через публичный API сервиса (getGlobalApiKey), а не через
 * внутренние поля: проверять надо наблюдаемое поведение — «после смены ключа
 * следующий запрос отдаёт новый», — а не то, какое поле обнулилось.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// vi.mock поднимается наверх файла, поэтому фикстуры создаём через vi.hoisted —
// иначе фабрика мока обращается к ещё не инициализированным переменным.
const h = vi.hoisted(() => {
  const state: { rows: any[] } = { rows: [] };
  const get = vi.fn(async () => ({ data: { data: state.rows } }));
  const patch = vi.fn(async (_url: string, body: any) => {
    Object.assign(state.rows[0], body);
    return { data: { data: state.rows[0] } };
  });
  const post = vi.fn(async () => ({ data: { data: state.rows[0] } }));
  return { state, get, patch, post };
});
const { state, get, patch, post } = h;

vi.mock('../directus', () => {
  const api = {
    get: (...a: any[]) => (h.get as any)(...a),
    patch: (...a: any[]) => (h.patch as any)(...a),
    post: (...a: any[]) => (h.post as any)(...a),
    delete: vi.fn(async () => ({ data: {} })),
  };
  return {
    directusApiManager: { instance: api, request: vi.fn(), cacheAuthToken: vi.fn() },
    directusApi: api,
    default: api,
  };
});

vi.mock('../services/directus-crud', () => ({
  directusCrud: { delete: vi.fn(async () => true), list: vi.fn(async () => []), getAdminAuthToken: vi.fn(async () => "admin-token"), getAdminTokenPublic: vi.fn(async () => "admin-token") },
}));

import { GlobalApiKeysService } from '../services/global-api-keys';

function makeService() {
  state.rows = [{ id: '1', service_name: 'qwen', api_key: 'OLD-KEY', is_active: true }];
  get.mockClear();
  return new GlobalApiKeysService();
}

describe('смена ключа видна сразу', () => {
  it('после update следующий getGlobalApiKey отдаёт новый ключ', async () => {
    const svc = makeService();

    expect(await svc.getGlobalApiKey('qwen')).toBe('OLD-KEY');

    await svc.updateGlobalApiKey('1', { api_key: 'NEW-KEY' } as never, 'admin-token');

    // Ключевое утверждение: без сброса рантайм-кеша здесь до часа возвращался
    // бы OLD-KEY, и пользователь считал бы, что смена ключа не работает.
    expect(await svc.getGlobalApiKey('qwen')).toBe('NEW-KEY');
  });

  it('неактивный ключ не отдаётся', async () => {
    const svc = makeService();
    expect(await svc.getGlobalApiKey('qwen')).toBe('OLD-KEY');

    await svc.updateGlobalApiKey('1', { is_active: false } as never, 'admin-token');

    expect(await svc.getGlobalApiKey('qwen')).toBeNull();
  });

  it('удалённый из хранилища ключ не отдаётся из кеша', async () => {
    const svc = makeService();
    expect(await svc.getGlobalApiKey('qwen')).toBe('OLD-KEY');

    // Имитируем удаление: строки больше нет, кеш сброшен операцией.
    await svc.updateGlobalApiKey('1', { is_active: false } as never, 'admin-token');
    state.rows = [];

    expect(await svc.getGlobalApiKey('qwen')).toBeNull();
  });
});

/**
 * Секрет не должен попадать в лог (AI-66).
 *
 * Раньше маршрут печатал весь `updateData`, а в нём лежит `api_key` — то есть
 * ключ оказывался в stdout контейнера, который читают при отладке. Проверяем
 * исходник: полноценный route-тест потребовал бы поднимать express и Directus,
 * а защищаемое свойство здесь текстовое — «значение не печатается».
 */
describe('ключ не утекает в лог', () => {
  const routeSrc = readFileSync(path.resolve(__dirname, '../routes-global-api-keys.ts'), 'utf8');
  const serviceSrc = readFileSync(path.resolve(__dirname, '../services/global-api-keys.ts'), 'utf8');

  it('маршрут обновления не печатает updateData целиком', () => {
    expect(routeSrc).not.toMatch(/console\.log\([^)]*,\s*updateData\s*\)/);
  });

  it('удаление не печатает объект ключа целиком', () => {
    expect(serviceSrc).not.toMatch(/console\.log\([^)]*,\s*keyInfo\s*\)/);
  });
});
