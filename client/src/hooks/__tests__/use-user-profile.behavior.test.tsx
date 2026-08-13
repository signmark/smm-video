/**
 * task #84: executable acceptance — React Query dedup, focus refresh, pricing
 * cache propagation, account-switch isolation. Реальный QueryClient + моканный
 * fetch; проверяем НАБЛЮДАЕМОЕ поведение, не исходник.
 *
 * useUserProfile читает профиль дефолтным queryFn (fetch по queryKey[0] =
 * /api/user/profile). Мокаем global fetch, считаем вызовы, крутим QueryClient.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useUserProfile, profileQueryKey } from '@/hooks/use-user-profile';
import { usePricingEntryProfileRefresh } from '@/hooks/use-pricing-entry';
import { useAuthStore } from '@/lib/store';
import { getQueryFn } from '@/lib/queryClient';

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: 'throw' }) as any,
        retry: false,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

// Мокаем useAuthStore, чтобы управлять userId.
function setUser(userId: string | null) {
  useAuthStore.setState({ userId, token: userId ? 'tok' : null } as any);
}

let fetchCount = 0;
let profilePayload: any;

function mockFetch(payload: any) {
  profilePayload = payload;
  fetchCount = 0;
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    fetchCount++;
    return new Response(JSON.stringify(profilePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;
}

const origFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  setUser('user-1');
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe('task #84: один холодный запрос при конкурентных наблюдателях', () => {
  it('два наблюдателя в одном QueryClient → один fetch', async () => {
    mockFetch({ id: 'u1', email: 'a@b.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();

    const { result: r1 } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    const { result: r2 } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(r1.current.data?.email).toBe('a@b.c');
      expect(r2.current.data?.email).toBe('a@b.c');
    });

    // Один общий ключ + один дефолтный queryFn → один HTTP-вызов.
    expect(fetchCount).toBe(1);
  });

  it('порядок монтирования не влияет: два порядка, всё равно один fetch', async () => {
    mockFetch({ id: 'u1', email: 'a@b.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();

    // Первый порядок: r1 затем r2.
    const a = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    const b = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => { expect(a.result.current.data?.email).toBe('a@b.c'); expect(b.result.current.data?.email).toBe('a@b.c'); });
    expect(fetchCount).toBe(1);
    a.unmount(); b.unmount();

    // Второй порядок (свежий QueryClient): r2 затем r1.
    fetchCount = 0;
    const qc2 = makeQC();
    const c = renderHook(() => useUserProfile(), { wrapper: wrapper(qc2) });
    const d = renderHook(() => useUserProfile(), { wrapper: wrapper(qc2) });
    await waitFor(() => { expect(c.result.current.data?.email).toBe('a@b.c'); expect(d.result.current.data?.email).toBe('a@b.c'); });
    expect(fetchCount).toBe(1);
  });
});

describe('task #84: focus-refresh подхватывает внешнее изменение тарифа', () => {
  it('blur/focus → ровно один новый вызов и значение обновилось', async () => {
    mockFetch({ id: 'u1', email: 'a@b.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    // useUserProfile сам задаёт refetchOnWindowFocus:true — QC default не трогаем.

    const { result } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.plan).toBe('basic'));
    expect(fetchCount).toBe(1);

    // Сервер теперь отдаёт pro (внешнее одобрение).
    profilePayload = { id: 'u1', email: 'a@b.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false };

    // Возврат фокуса окна через focusManager.
    act(() => { focusManager.setFocused(false); });
    await act(async () => { focusManager.setFocused(true); });

    await waitFor(() => expect(result.current.data?.plan).toBe('pro'));
    expect(fetchCount).toBe(2);
  });
});

describe('task #84: pricing refetch обновляет общий кэш', () => {
  it('refetch из одного наблюдателя виден другому', async () => {
    mockFetch({ id: 'u1', email: 'a@b.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    const a = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    const b = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => { expect(a.result.current.data?.plan).toBe('basic'); expect(b.result.current.data?.plan).toBe('basic'); });
    expect(fetchCount).toBe(1);

    profilePayload = { id: 'u1', email: 'a@b.c', plan: 'enterprise', first_name: '', last_name: '', is_smm_admin: false };

    // Один наблюдатель явно refetch (граница pricing).
    await act(async () => { await a.result.current.refetch(); });

    await waitFor(() => expect(b.result.current.data?.plan).toBe('enterprise'));
    // refetch — ровно один новый вызов.
    expect(fetchCount).toBe(2);
  });
});

describe('task #84: изоляция при смене аккаунта', () => {
  it('смена userId → новый ключ, старые данные не светятся', async () => {
    mockFetch({ id: 'u1', email: 'u1@x.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    const { result, rerender } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.email).toBe('u1@x.c'));
    expect(fetchCount).toBe(1);

    // Смена аккаунта: другой userId (обёрнуто в act — это state update).
    profilePayload = { id: 'u2', email: 'u2@x.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false };
    act(() => { setUser('user-2'); });
    rerender();

    // Читаемое значение теперь от user-2; user-1 на экране не светится.
    await waitFor(() => expect(result.current.data?.email).toBe('u2@x.c'));
    expect(result.current.data?.email).not.toBe('u1@x.c');
    // Новый ключ → новый fetch.
    expect(fetchCount).toBe(2);

    // Ключ user-2 закэширован; старый ключ user-1 продолжает жить в кэше (gcTime),
    // но ни один observer его больше не читает.
    expect(qc.getQueryData(profileQueryKey('user-2'))).toBeDefined();
  });
});

describe('task #84: logout/clear + новый сеанс (граница forceLogout)', () => {
  it('logout clear стирает старые данные, новая сессия — ровно один новый fetch', async () => {
    mockFetch({ id: 'u1', email: 'u1@x.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    const { result } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.email).toBe('u1@x.c'));
    expect(fetchCount).toBe(1);

    // Граница logout: queryClient.clear() (то же, что forceLogout) + сброс auth.
    act(() => { qc.clear(); useAuthStore.getState().clearAuth(); });

    // Новый сеанс того же/нового пользователя.
    profilePayload = { id: 'u2', email: 'u2@x.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false };
    act(() => { setUser('user-2'); });

    // Ровно один новый fetch, старый email/plan не рендерится.
    await waitFor(() => expect(result.current.data?.email).toBe('u2@x.c'));
    expect(result.current.data?.email).not.toBe('u1@x.c');
    expect(fetchCount).toBe(2);
  });
});

describe('task #84: вход на pricing дергает canonical refetch', () => {
  it('usePricingEntryProfileRefresh → один canonical вызов, другой наблюдатель видит обновление', async () => {
    mockFetch({ id: 'u1', email: 'a@b.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    const a = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(a.result.current.data?.plan).toBe('basic'));
    expect(fetchCount).toBe(1);

    profilePayload = { id: 'u1', email: 'a@b.c', plan: 'enterprise', first_name: '', last_name: '', is_smm_admin: false };

    // Вход на pricing монтирует границу refresh.
    renderHook(() => usePricingEntryProfileRefresh(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(a.result.current.data?.plan).toBe('enterprise'));
    // Монтирование pricing-границы + её canonical refetch = ровно один новый вызов.
    expect(fetchCount).toBe(2);
  });
});

describe('task #84: повторный вход ТЕМ ЖЕ пользователем (новый сеанс)', () => {
  it('logout-clear стирает старый профиль, новый сеанс user-1 с новыми данными', async () => {
    mockFetch({ id: 'u1', email: 'old@x.c', plan: 'basic', first_name: '', last_name: '', is_smm_admin: false });
    const qc = makeQC();
    const { result, rerender } = renderHook(() => useUserProfile(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.email).toBe('old@x.c'));
    expect(fetchCount).toBe(1);

    // Реальная граница logout: queryClient.clear() (то же, что logout/forceLogout).
    act(() => { qc.clear(); });

    // Новый сеанс — ТОТ ЖЕ user-1, но сервер отдал новый email/plan.
    profilePayload = { id: 'u1', email: 'new@x.c', plan: 'pro', first_name: '', last_name: '', is_smm_admin: false };
    act(() => { setUser('user-1'); });
    rerender();

    await waitFor(() => expect(result.current.data?.email).toBe('new@x.c'));
    // Ровно один свежий вызов после перезахода тем же пользователем.
    expect(fetchCount).toBe(2);
    // Старый email нигде не рендерится.
    expect(result.current.data?.email).not.toBe('old@x.c');
  });
});
