/**
 * Регрессия: DirectusCrud молча ходил в Directus без заголовка Authorization,
 * если вызывающий забыл передать authToken/useAdminToken.
 *
 * Инцидент: `directusCrud.getById('campaigns', id)` и
 * `directusCrud.list('campaign_trend_topics', {...})` уходили анонимно, Directus
 * отвечал 403, а ближайший catch превращал это в «настроек нет» / «трендов нет».
 * В логах приложения не было ничего — 403 виднелись только в логах Directus.
 *
 * Контракт: запрос без токена и без явного allowAnonymous — ошибка в логе,
 * называющая операцию и коллекцию. Осознанно анонимный запрос молчит.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { DirectusCrud } from '../services/directus-crud';

vi.mock('axios', () => {
  const fn: any = vi.fn(async () => ({ data: { data: [] } }));
  fn.post = vi.fn();
  fn.delete = vi.fn(async () => ({ data: { data: null } }));
  return { default: fn };
});

const axiosMock = axios as unknown as ReturnType<typeof vi.fn>;

describe('DirectusCrud: запрос без токена', () => {
  let crud: DirectusCrud;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'http://mock-directus';
    crud = new DirectusCrud();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('ругается в лог, называя операцию и коллекцию', async () => {
    await crud.list('campaign_trend_topics');

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('list campaign_trend_topics');
    expect(logged).toContain('без токена');
  });

  it('называет коллекцию и для чтения по id', async () => {
    await crud.getById('user_campaigns', 'camp-1');

    const logged = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('read user_campaigns');
  });

  it('не ставит заголовок Authorization, раз токена нет', async () => {
    await crud.list('user_campaigns');

    const config = axiosMock.mock.calls[0][0] as any;
    expect(config.headers?.Authorization).toBeUndefined();
  });

  it('молчит, если анонимность заявлена явно', async () => {
    await crud.list('user_campaigns', { allowAnonymous: true });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('молчит, когда токен передан', async () => {
    await crud.list('user_campaigns', { authToken: 'jwt-token' });

    expect(errorSpy).not.toHaveBeenCalled();
    const config = axiosMock.mock.calls[0][0] as any;
    expect(config.headers?.Authorization).toBe('Bearer jwt-token');
  });
});
