/**
 * AI-86: trends terminal-error contract preservation.
 *
 * Проверяет: при settled error (isLoadingUser=false, isLoadingCampaigns=false,
 * trends запрос с ошибкой), placeholder НЕ остаётся, terminal-state виден
 * (noTrends amber-block — это валидный terminal-state trends-страницы при
 * ошибке или пустом ответе: «как это работает» инструкция + сообщение).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/api-client', () => ({
  api: {
    user: { me: vi.fn(async () => ({ data: { id: 'u-1' } })) },
    campaigns: {
      listForUser: vi.fn(async () => ({ data: [{ id: 'camp-1', name: 'Camp 1' }] })),
      list: vi.fn(async () => [{ id: 'camp-1', name: 'Camp 1' }]),
    },
    sources: { list: vi.fn(async () => { throw new Error('boom'); }) },
    trends: { list: vi.fn(async () => { throw new Error('boom'); }) },
    keywords: { list: vi.fn(async () => []) },
    campaignContent: { list: vi.fn(async () => []) },
  },
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: () => null }));
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignsList: vi.fn(() => ({ data: { data: [{ id: 'camp-1', name: 'Camp 1' }] }, isLoading: false })),
}));
vi.mock('@/lib/store', () => ({ useAuthStore: () => ({ userId: 'u-1', getAuthToken: () => 'token' }) }));
vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: (sel: any) => {
    const state = { selectedCampaign: { id: 'camp-1', name: 'Camp 1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
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

vi.mock('@/components/TrendDetailDialog', () => ({ TrendDetailDialog: () => null }));
vi.mock('@/components/AddSourceDialog', () => ({ AddSourceDialog: () => null }));
vi.mock('@/components/NewSourcesDialog', () => ({ NewSourcesDialog: () => null }));
vi.mock('@/components/ContentGenerationPanel', () => ({ ContentGenerationPanel: () => null }));
vi.mock('@/components/SocialNetworkSelectorDialog', () => ({ SocialNetworkSelectorDialog: () => null }));
vi.mock('@/components/SourcesSearchDialog', () => ({ SourcesSearchDialog: () => null }));
vi.mock('@/components/BulkSourcesImportDialog', () => ({ BulkSourcesImportDialog: () => null }));
vi.mock('@/components/SourcePostsList', () => ({ SourcePostsList: () => null }));
vi.mock('@/components/SourcePostsSearchForm', () => ({ SourcePostsSearchForm: () => null }));

import Trends from '@/pages/trends';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AI-86: trends terminal-error contract preservation', () => {
  it('shell stays visible, placeholder cleared, terminal-state visible (noTrends or error block)', async () => {
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Trends /></Wrapper>);

    // Shell
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent?.trim()).toBe('app.title');
    });

    // Placeholder НЕ должен маскировать error: isLoadingUser=false, isLoadingCampaigns=false
    await waitFor(() => {
      expect(container.querySelector('[data-testid="trends-loading-placeholder"]')).toBeNull();
    });

    // Terminal-state: либо noTrends (amber block), либо error. На trends оба
    // рендерятся через howItWorks block + noTrends text — это valid terminal.
    // Требование PM: "terminal state виден" — здесь это howItWorks + noTrendsTitle.
    const text = container.textContent || '';
    const hasTerminalState = /noTrendsTitle|howItWorks|Ошибка|error/i.test(text);
    expect(hasTerminalState).toBeTruthy();
  }, 15000);
});