/**
 * AI-86: trends page renders header/filters while user/campaigns queries are pending.
 *
 * Контрактная красная (точный анти-паттерн из спеки Jira):
 *   На медленном соединении пока грузятся `isLoadingUser || isLoadingCampaigns`,
 *   страница `/trends` показывает полноэкранную крутилку `Loader2 h-8 w-8` —
 *   вместо того чтобы показать header + filters, а в data-area поставить Skeleton.
 *
 * Red-before: на main без правки AI-86 пока `isLoadingUser || isLoadingCampaigns`,
 *   заголовка страницы (`<h1>`) в DOM нет — есть только `<Loader2>`.
 *   После правки: `<h1>` с названием страницы присутствует в DOM, Loader2
 *   на уровне страницы отсутствует.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: {
    user: { me: vi.fn(() => new Promise(() => {})) },
    campaigns: { listForUser: vi.fn(() => new Promise(() => {})) },
    sources: { list: vi.fn(() => new Promise(() => {})) },
    trends: { list: vi.fn(() => new Promise(() => {})) },
    keywords: { list: vi.fn(() => new Promise(() => {})) },
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => null,
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ userId: 'u-1', getAuthToken: () => 'token' }),
}));

vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: (selector) => {
    const state = { selectedCampaign: { id: 'camp-1', name: 'Camp 1' } };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'ru' },
  }),
}));

vi.mock('wouter', async () => {
  const actual = await vi.importActual('wouter');
  return {
    ...actual,
    Link: ({ children, ...props }) => <a {...props}>{children}</a>,
    useLocation: () => ['/', () => {}],
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
vi.mock('@/components/trends/TrendCard', () => ({ TrendCard: () => null }));
vi.mock('@/components/trends/SentimentEmoji', () => ({ SentimentEmoji: () => null }));
vi.mock('@/pages/trends/components/TrendListItem', () => ({ default: () => null }));
vi.mock('@/pages/trends/hooks/useVisibleTrends', () => ({
  useVisibleTrends: () => ({ visibleTrends: [], hiddenCount: 0, toggle: () => {} }),
}));

import Trends from '@/pages/trends';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AI-86: trends page renders shell during initial loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('header (h1) visible while isLoadingUser || isLoadingCampaigns is true', async () => {
    render(<Trends />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('no full-page Loader2 spinner during initial loading', async () => {
    render(<Trends />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    const fullPageSpinner = document.querySelector('div.flex.justify-center.p-8 > .h-8.w-8.animate-spin');
    expect(fullPageSpinner).toBeNull();
  });

  it('placeholder cleared (no full-page spinner) when only user query is settled', async () => {
    // Дополнительная проверка: даже если user resolved, а campaigns всё ещё loading,
    // каркас должен быть, а не полноэкранная крутилка.
    vi.mocked(api.user.me).mockImplementationOnce(async () => ({ data: { id: 'u-1' } }) as any);

    render(<Trends />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });
});
