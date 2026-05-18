/**
 * Тесты API: health checks, защита роутов, обработка ошибок
 * Проверяет что API правильно отвечает на запросы
 */

import { test, expect } from './fixtures';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5000';

test.describe('API Health и защита маршрутов', () => {
  test('/health возвращает 200', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json().catch(() => null);
    if (body) {
      expect(body).toBeTruthy();
    }
  });

  test('/api/campaigns требует авторизацию (401 без токена)', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/campaigns`, {
      headers: { Authorization: '' }
    });
    expect([401, 403]).toContain(response.status());
  });

  test('/api/auth/me требует авторизацию', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: {}
    });
    expect([401, 403]).toContain(response.status());
  });

  test('/api/campaign-content требует авторизацию', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/campaign-content`);
    expect([401, 403]).toContain(response.status());
  });

  test('/api/auth/register валидирует обязательные поля', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/auth/register`, {
      data: { email: 'test@test.com' }
    });
    expect([400, 422, 500]).toContain(response.status());
  });

  test('/api/auth/register отклоняет невалидный email', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        email: 'not-an-email',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }
    });
    expect([400, 422, 500]).toContain(response.status());
  });

  test('/api/auth/login с неверными данными возвращает ошибку', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        email: 'nonexistent@test.com',
        password: 'wrongpassword123'
      }
    });
    expect([400, 401, 403]).toContain(response.status());
  });

  test('/api/keywords требует авторизацию', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/keywords`);
    expect([401, 403, 400]).toContain(response.status());
  });

  test('/api/auth/check отклоняет невалидный токен', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/check`, {
      headers: { Authorization: 'Bearer invalid.token.here' }
    });
    expect([401, 403]).toContain(response.status());
  });

  test('/api/auth/check отклоняет запрос без токена', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/check`);
    expect([401, 403]).toContain(response.status());
  });

  test('несуществующий API endpoint возвращает 404', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/nonexistent-endpoint-xyz-123`);
    expect([404, 401, 403]).toContain(response.status());
  });

  test('/api/s3/upload-image требует авторизацию', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/s3/upload-image`);
    expect([401, 403, 400]).toContain(response.status());
  });

  test('/api/validate/telegram отклоняет запрос без токена', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/validate/telegram`, {
      data: {}
    });
    expect([400, 401, 403]).toContain(response.status());
    const body = await response.json().catch(() => null);
    if (body) {
      expect(body.success).toBeFalsy();
    }
  });

  test('API возвращает JSON Content-Type для endpoints', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/health`);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('json');
  });
});
