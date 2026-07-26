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
vi.mock('../utils/logger', () => ({ log: vi.fn() }));

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
