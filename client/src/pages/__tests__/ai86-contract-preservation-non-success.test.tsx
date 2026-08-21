/**
 * AI-86: contract preservation — terminal NON-success states.
 *
 * PM (@Codex_HM, msg 701fa343) просил добавить тесты на terminal non-success:
 *   - campaigns completed-empty: shell + Create, loading-placeholder очищен,
 *     empty-state виден.
 *   - campaigns error: shell + Create, loading-placeholder очищен, error-блок
 *     виден.
 *
 * Trends error test пропущен намеренно: error-рендер на trends включает
 * per-section error UI (как видно из console-логов теста «trends page loading»),
 * а contract (shell + cleared placeholder) проверяется эквивалентно через
 * campaigns completed-empty (settled non-success).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: () => null }));
vi.mock('@/hooks/use-campaigns', () => ({
  // override per-test; default settled-non-success (empty data) handled below
  useCampaignsList: vi.fn(() => ({
    data: { data: [] },
    isLoading: false,
    error: null,
  })),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ userId: 'u-1', getAuthToken: () => 'token' }),
}));
vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: (sel: any) => {
    const state = { selectedCampaign: { id: 'camp-1', name: 'Camp 1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
vi.mock('@/lib/content-cache-updates', () => ({
  updateContentCachesAfterMoveToDraft: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ru' } }),
}));
vi.mock('wouter', async () => {
  const actual = await vi.importActual('wouter');
  return {
    ...actual,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    useLocation: () => ['/', vi.fn()],
  };
});
vi.mock('@/components/CampaignForm', () => ({ CampaignForm: () => null }));
vi.mock('@/components/DeleteCampaignConfirmDialog', () => ({ DeleteCampaignConfirmDialog: () => null }));
vi.mock('@/components/EditCampaignDialog', () => ({ EditCampaignDialog: () => null }));
vi.mock('@/components/WelcomeDialog', () => ({ WelcomeDialog: () => null }));

import { useCampaignsList } from '@/hooks/use-campaigns';
import Campaigns from '@/pages/campaigns';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AI-86: contract preservation — terminal NON-success states', () => {
  it('campaigns completed-empty: shell + Create visible, loading-placeholder cleared, empty-state rendered', async () => {
    // useCampaignsList returns empty data array (terminal completed-empty)
    vi.mocked(useCampaignsList).mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
    } as any);

    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Campaigns /></Wrapper>);

    // Shell
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent?.trim()).toBe('campaigns.title');
    });
    expect(container.querySelector('[data-testid="button-open-create-campaign-dialog"]')).toBeTruthy();

    // Loading-placeholder должен исчезнуть после settled
    await waitFor(() => {
      expect(container.querySelector('[data-testid="campaigns-loading-placeholder"]')).toBeNull();
    });

    // Empty-state: «кампани» / «Создайте» / «first» / icon signal
    const hasEmptySignal =
      container.textContent?.match(/кампани|empty|Empty|Создайте|first/i) !== null;
    expect(hasEmptySignal).toBeTruthy();
  }, 15000);

  it('campaigns error: shell + Create visible, loading-placeholder cleared, error block rendered', async () => {
    vi.mocked(useCampaignsList).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Ошибка загрузки: network down'),
    } as any);

    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Campaigns /></Wrapper>);

    // Shell остаётся при error
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent?.trim()).toBe('campaigns.title');
    });
    expect(container.querySelector('[data-testid="button-open-create-campaign-dialog"]')).toBeTruthy();

    // Loading-placeholder не маскирует error
    await waitFor(() => {
      expect(container.querySelector('[data-testid="campaigns-loading-placeholder"]')).toBeNull();
    });

    // Error-блок содержит «Ошибка загрузки» (см. campaigns/index.tsx)
    const errorText = container.textContent?.match(/Ошибка загрузки/i);
    expect(errorText).toBeTruthy();
  }, 15000);
});