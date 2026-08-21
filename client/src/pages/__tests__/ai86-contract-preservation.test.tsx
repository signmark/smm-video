/**
 * AI-86: contract preservation for trends & campaigns — success-state tests.
 *
 * Confirms that when data has settled (no longer loading), the shell stays
 * visible AND the data-area is replaced with real content (no leftover
 * skeleton placeholder).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: () => null }));
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignsList: vi.fn(() => ({
    data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
    isLoading: false,
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

vi.mock('@/components/TrendDetailDialog', () => ({ TrendDetailDialog: () => null }));
vi.mock('@/components/AddSourceDialog', () => ({ AddSourceDialog: () => null }));
vi.mock('@/components/NewSourcesDialog', () => ({ NewSourcesDialog: () => null }));
vi.mock('@/components/ContentGenerationPanel', () => ({ ContentGenerationPanel: () => null }));
vi.mock('@/components/SocialNetworkSelectorDialog', () => ({ SocialNetworkSelectorDialog: () => null }));
vi.mock('@/components/SourcesSearchDialog', () => ({ SourcesSearchDialog: () => null }));
vi.mock('@/components/BulkSourcesImportDialog', () => ({ BulkSourcesImportDialog: () => null }));
vi.mock('@/components/SourcePostsList', () => ({ SourcePostsList: () => null }));
vi.mock('@/components/SourcePostsSearchForm', () => ({ SourcePostsSearchForm: () => null }));
vi.mock('@/components/CampaignForm', () => ({ CampaignForm: () => null }));
vi.mock('@/components/DeleteCampaignConfirmDialog', () => ({ DeleteCampaignConfirmDialog: () => null }));
vi.mock('@/components/EditCampaignDialog', () => ({ EditCampaignDialog: () => null }));
vi.mock('@/components/WelcomeDialog', () => ({ WelcomeDialog: () => null }));

// All api returns resolved immediately — success scenario
vi.mock('@/lib/api-client', () => {
  const api = {
    user: { me: vi.fn(async () => ({ data: { id: 'u-1' } })) },
    campaigns: {
      listForUser: vi.fn(async () => ({ data: [{ id: 'camp-1', name: 'Camp 1' }] })),
      list: vi.fn(async () => [{ id: 'camp-1', name: 'Camp 1' }]),
    },
    sources: { list: vi.fn(async () => []) },
    trends: { list: vi.fn(async () => []) },
    keywords: { list: vi.fn(async () => []) },
    campaignContent: { list: vi.fn(async () => []) },
  };
  return { api };
});

import Trends from '@/pages/trends';
import Campaigns from '@/pages/campaigns';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('AI-86: contract preservation (success/empty state)', () => {
  it('trends: shell stays visible after loading settles, skeleton placeholder cleared', async () => {
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Trends /></Wrapper>);
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent?.trim()).toBe('app.title');
    });
    expect(container.querySelector('div.flex.justify-center.p-8 > .h-8.w-8.animate-spin')).toBeNull();
    // skeleton placeholder должен очиститься после settled
    await waitFor(() => {
      expect(container.querySelector('[data-testid="trends-loading-placeholder"]')).toBeNull();
    });
  }, 15000);

  it('campaigns: shell + Create button stays visible, campaigns-loading-placeholder cleared after data settled', async () => {
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Campaigns /></Wrapper>);
    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent?.trim()).toBe('campaigns.title');
    });
    expect(container.querySelector('[data-testid="button-open-create-campaign-dialog"]')).toBeTruthy();
    // Когда данные пришли (mock useCampaignsList = resolved), placeholder очищается
    await waitFor(() => {
      expect(container.querySelector('[data-testid="campaigns-loading-placeholder"]')).toBeNull();
    });
  }, 15000);
});