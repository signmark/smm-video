/**
 * Unit tests for server/utils/token-handler.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenHandler } from '../utils/token-handler';

describe('server/utils/token-handler', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('validateUserToken', () => {
    it('должен возвращать userId и email из валидного JWT', async () => {
      const payload = { id: 'user-123', email: 'user@test.com' };
      const token = createJwt(payload);

      const result = await TokenHandler.validateUserToken(token);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'user@test.com',
      });
    });

    it('должен возвращать unknown@email.com если email отсутствует', async () => {
      const payload = { id: 'user-456' };
      const token = createJwt(payload);

      const result = await TokenHandler.validateUserToken(token);

      expect(result).toEqual({
        userId: 'user-456',
        email: 'unknown@email.com',
      });
    });

    it('должен возвращать null для невалидного формата (не 3 части)', async () => {
      const result = await TokenHandler.validateUserToken('invalid.token');
      expect(result).toBeNull();
    });

    it('должен возвращать null для токена без id в payload', async () => {
      const payload = { email: 'test@test.com' };
      const token = createJwt(payload);

      const result = await TokenHandler.validateUserToken(token);

      expect(result).toBeNull();
    });

    it('должен возвращать null для невалидного base64 в payload', async () => {
      const token = 'eyJ.x.xxx';
      const result = await TokenHandler.validateUserToken(token);
      expect(result).toBeNull();
    });
  });

  describe('getTokenExpiredResponse', () => {
    it('должен возвращать стандартный объект ответа', () => {
      const response = TokenHandler.getTokenExpiredResponse();
      expect(response).toEqual({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        message: 'Please log in again',
      });
    });
  });

  describe('getAdminToken', () => {
    it('должен возвращать DIRECTUS_STATIC_TOKEN из env', () => {
      process.env.DIRECTUS_STATIC_TOKEN = 'admin-secret-123';
      expect(TokenHandler.getAdminToken()).toBe('admin-secret-123');
    });

    it('должен возвращать null при отсутствии DIRECTUS_STATIC_TOKEN', () => {
      delete process.env.DIRECTUS_STATIC_TOKEN;
      expect(TokenHandler.getAdminToken()).toBeNull();
    });
  });

  describe('isAdminToken', () => {
    it('должен возвращать true когда токен совпадает с DIRECTUS_STATIC_TOKEN', () => {
      process.env.DIRECTUS_STATIC_TOKEN = 'admin-token';
      expect(TokenHandler.isAdminToken('admin-token')).toBe(true);
    });

    it('должен возвращать false при несовпадении', () => {
      process.env.DIRECTUS_STATIC_TOKEN = 'admin-token';
      expect(TokenHandler.isAdminToken('user-token')).toBe(false);
    });

    it('должен возвращать false при отсутствии DIRECTUS_STATIC_TOKEN', () => {
      delete process.env.DIRECTUS_STATIC_TOKEN;
      expect(TokenHandler.isAdminToken('any-token')).toBe(false);
    });
  });
});

function createJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}
