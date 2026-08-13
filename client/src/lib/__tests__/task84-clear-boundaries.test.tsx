/**
 * task #86 follow-up: T1/T2/T3 — реальные production-пути очистки кэша профиля.
 *
 * Проверяем, что каждая из ТРЁХ независимых границ logout реально чистит
 * ЕДИНСТВЕННЫЙ синглтон queryClient (а не копию в тесте).
 *
 * T1 — use-auth.tsx logoutMutation (кнопка выхода).
 * T2 — queryClient.ts forceLogout через 401 + refreshAuthSession='invalid'.
 * T3 — lib/auth.ts logout (performLogout).
 *
 * У каждого мутация-ред: убрать ровно один queryClient.clear() → падает ровно
 * свой тест, соседние зелёные.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

// Моки оформляем ДО импорта модулей, которые их используют.
vi.mock('@/lib/refreshAuth', () => ({
  refreshAuthSession: vi.fn().mockResolvedValue('invalid'),
  setupTokenRefreshFromToken: vi.fn(),
  stopRefreshInterval: vi.fn(),
  startRefreshInterval: vi.fn(),
  setupTokenRefresh: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/lib/public-routes', () => ({
  redirectToLogin: vi.fn(),
  isPublicRoute: () => true,
  PUBLIC_ROUTES: [],
}));

import { queryClient } from '@/lib/queryClient';
import { profileQueryKey } from '@/hooks/use-user-profile';
import { useAuthStore } from '@/lib/store';

// Не храним origFetch — при каждом тесте ставим свой мок, после гасим.
function seedProfile() {
  queryClient.setQueryData(profileQueryKey('user-1'), {
    id: 'u1', email: 'old@x.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false,
  });
}

function mockFetch(status: number, body = '{}') {
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  localStorage.clear();
  useAuthStore.setState({ token: 'tok', userId: 'user-1', isAuthenticated: true } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
  localStorage.clear();
});

describe('task #86 T3: lib/auth.ts logout чистит синглтон queryClient', () => {
  it('logout() очищает реальный queryClient', async () => {
    const { logout } = await import('@/lib/auth');
    mockFetch(200);
    seedProfile();
    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeDefined();

    await logout();

    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeUndefined();
  });
});

describe('task #86 T1: use-auth logoutMutation чистит синглтон queryClient', () => {
  it('logoutMutation.mutateAsync очищает реальный queryClient', async () => {
    const { AuthProvider, useAuth } = await import('@/hooks/use-auth');
    mockFetch(200);
    seedProfile();

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }: any) => (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children as any}</AuthProvider>
        </QueryClientProvider>
      ),
    });

    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeDefined();

    await act(async () => {
      await result.current.logoutMutation.mutateAsync();
    });

    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeUndefined();
  });
});

describe('task #86 T2: forceLogout через 401+invalid чистит синглтон queryClient', () => {
  it('apiRequest с 401 и refreshAuthSession=invalid очищает queryClient', async () => {
    const { apiRequest } = await import('@/lib/queryClient');
    seedProfile();
    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeDefined();

    mockFetch(401, '{}');

    await expect(apiRequest('/api/anything')).rejects.toThrow();

    // forceLogout вызвал queryClient.clear() на синглтоне.
    expect(queryClient.getQueryData(profileQueryKey('user-1'))).toBeUndefined();
  });
});
