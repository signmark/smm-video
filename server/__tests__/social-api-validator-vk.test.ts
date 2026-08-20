import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { validateVkToken } from '../services/social-api-validator';

// VK API отдаёт ошибки метода в теле ответа с HTTP 200 — axios такой ответ
// резолвит, а не реджектит. В `validateVkToken` ветка groups.getById
// обрабатывала только успешный массив и rejected promise, поэтому resolved
// `{ error: ... }` проваливался к общему `isValid: true`: провал проверки
// группы выглядел успешной валидацией.
//
// Дефект найден Codex (rev2, неблокирующее замечание 2), существовал в winning
// validator до консолидации /api/validate/*. Тест держит границу отдельно от
// route-теста, потому что это правка сервиса, а не маршрутов.

vi.mock('axios');
vi.mock('../utils/logger', () => ({ log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const USERS_GET = 'https://api.vk.com/method/users.get';
const GROUPS_GET_BY_ID = 'https://api.vk.com/method/groups.getById';

const USER = { id: 42, first_name: 'Иван', last_name: 'Петров' };
const GROUP = { id: 777, name: 'Тестовая группа' };

/** Разводит два последовательных запроса VK по URL. */
const stubVk = (usersGet: any, groupsGetById?: any) => {
  (axios.get as any).mockImplementation(async (url: string) => {
    if (url === USERS_GET) return usersGet;
    if (url === GROUPS_GET_BY_ID) {
      if (groupsGetById instanceof Error) throw groupsGetById;
      return groupsGetById;
    }
    throw new Error(`Неожиданный URL: ${url}`);
  });
};

describe('validateVkToken — проверка группы', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolved { error } от groups.getById → isValid false, user и groupError сохранены', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { error: { error_code: 15, error_msg: 'Access denied: group is blocked' } } },
    );

    const result = await validateVkToken('vk1.token', '777');

    expect(result.isValid).toBe(false);
    expect(result.details.user).toEqual(USER);
    expect(result.details.groupError).toEqual({
      error: { error_code: 15, error_msg: 'Access denied: group is blocked' },
    });
    expect(result.message).toContain('ошибка при проверке группы');
  });

  it('malformed ответ groups.getById без массива → isValid false', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { response: { unexpected: 'object' } } },
    );

    const result = await validateVkToken('vk1.token', '777');

    expect(result.isValid).toBe(false);
    expect(result.details.user).toEqual(USER);
    expect(result.details.groupError).toBeDefined();
  });

  it('оба запроса успешны → isValid true', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { response: [GROUP] } },
    );

    const result = await validateVkToken('vk1.token', '777');

    expect(result.isValid).toBe(true);
    expect(result.details.user).toEqual(USER);
    expect(result.details.group).toEqual(GROUP);
  });

  it('users.get отдаёт структурный error_code 5 → isValid false, код доступен в details', async () => {
    stubVk({ data: { error: { error_code: 5, error_msg: 'User authorization failed' } } });

    const result = await validateVkToken('vk1.протухший');

    expect(result.isValid).toBe(false);
    expect(result.details.error.error_code).toBe(5);
  });

  it('rejected promise от groups.getById по-прежнему обрабатывается', async () => {
    const rejected: any = new Error('socket hang up');
    rejected.response = { data: { error: { error_code: 10 } } };
    stubVk({ data: { response: [USER] } }, rejected);

    const result = await validateVkToken('vk1.token', '777');

    expect(result.isValid).toBe(false);
    expect(result.details.user).toEqual(USER);
  });

  // Продакшен-кампания «omemo.tech» (группа «Движение к миллионам с Дмитрием
  // Ждановым») хранит groupId как -176171231. groups.getById отвечает на него
  // ошибкой 100 «group_id should be greater than 0» — живой админский токен
  // выглядел сломанным, и карточка уезжала в «Требует переподключения».
  describe('нормализация groupId перед groups.getById', () => {
    it.each([
      ['-176171231', '176171231', 'отрицательный id из настроек'],
      ['176171231', '176171231', 'уже положительный id'],
      ['club226440032', '226440032', 'префикс club'],
      ['https://vk.com/club226440032', '226440032', 'полный URL с club'],
      ['https://vk.com/avtocargo_pro03', 'avtocargo_pro03', 'URL со screen_name'],
      ['omemo_education', 'omemo_education', 'голый screen_name'],
    ])('%s → group_id=%s (%s)', async (stored, expected) => {
      stubVk({ data: { response: [USER] } }, { data: { response: [GROUP] } });

      const result = await validateVkToken('vk1.token', stored);

      expect(result.isValid).toBe(true);
      const groupCall = (axios.get as any).mock.calls
        .find((call: any[]) => call[0] === GROUPS_GET_BY_ID);
      expect(groupCall[1].params.group_id).toBe(expected);
    });

    it('пустой groupId не порождает запрос к groups.getById', async () => {
      stubVk({ data: { response: [USER] } });

      const result = await validateVkToken('vk1.token', '');

      expect(result.isValid).toBe(true);
      expect((axios.get as any).mock.calls.some((c: any[]) => c[0] === GROUPS_GET_BY_ID)).toBe(false);
    });
  });

  it('токен не попадает в message и details', async () => {
    const token = 'vk1.секретный-токен-кампании';
    stubVk(
      { data: { response: [USER] } },
      { data: { error: { error_code: 15, error_msg: 'Access denied' } } },
    );

    const result = await validateVkToken(token, '777');

    expect(JSON.stringify(result)).not.toContain(token);
  });
});

/**
 * Форма ответа groups.getById зависит от версии API, а версия — от типа токена:
 *   v5.131 (старые токены) → { response: [ {...} ] }
 *   v5.199 (vk2-токены)    → { response: { groups: [ {...} ] } }
 * Проверка ждала только массив, и после перехода на v5.199 живая группа
 * опознавалась как «неожиданный ответ» — прод 29.07.2026, сразу после
 * успешного переподключения.
 */
describe('validateVkToken — формы ответа по версиям API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('v5.199: response.groups[] → isValid true', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { response: { groups: [GROUP] } } },
    );

    const result = await validateVkToken('vk2.токен', '777');

    expect(result.isValid).toBe(true);
    expect(result.details.group).toEqual(GROUP);
  });

  it('v5.131: response[] по-прежнему работает', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { response: [GROUP] } },
    );

    expect((await validateVkToken('старый-токен', '777')).isValid).toBe(true);
  });

  it('пустой список сообществ → isValid false', async () => {
    stubVk(
      { data: { response: [USER] } },
      { data: { response: { groups: [] } } },
    );

    expect((await validateVkToken('vk2.токен', '777')).isValid).toBe(false);
  });

  it('vk2-токен уходит Bearer-заголовком с v5.199, без access_token в query', async () => {
    stubVk({ data: { response: [USER] } }, { data: { response: { groups: [GROUP] } } });

    await validateVkToken('vk2.секрет', '777');

    const call = (axios.get as any).mock.calls.find((c: any[]) => c[0] === USERS_GET);
    expect(call[1].headers.Authorization).toBe('Bearer vk2.секрет');
    expect(call[1].params.v).toBe('5.199');
    expect(call[1].params.access_token).toBeUndefined();
  });

  it('старый токен уходит параметром access_token с v5.131', async () => {
    stubVk({ data: { response: [USER] } });

    await validateVkToken('старый-токен');

    const call = (axios.get as any).mock.calls.find((c: any[]) => c[0] === USERS_GET);
    expect(call[1].headers).toBeUndefined();
    expect(call[1].params.v).toBe('5.131');
    expect(call[1].params.access_token).toBe('старый-токен');
  });
});
