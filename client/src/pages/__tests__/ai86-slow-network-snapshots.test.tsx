/**
 * AI-86: slow-network browser-equivalent snapshot — evidence-only test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const DELAY_MS = 5000;
const delayed = <T,>(value: T, ms: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: () => null }));
vi.mock('@/hooks/use-campaigns', () => ({
  // controlled per-test by overriding beforeEach; default for trends is loaded
  useCampaignsList: vi.fn(() => ({
    data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
    isLoading: false,
  })),
}));
vi.mock('@/lib/store', () => ({
  useAuthStore: (selector: any) => {
    const state = { userId: 'u-1', getAuthToken: () => 'token' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: (selector: any) => {
    const state = { selectedCampaign: { id: 'camp-1', name: 'Camp 1' } };
    return typeof selector === 'function' ? selector(state) : state;
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

vi.mock('@/components/ScheduledPublicationDetails', () => ({
  default: ({ content }: any) => <div data-testid={`pub-${content.id}`}>{content.title}</div>,
}));
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

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(() => delayed({ data: [] }, DELAY_MS)),
}));

vi.mock('@/lib/api-client', () => {
  const api = {
    user: { me: vi.fn(() => delayed({ data: { id: 'u-1' } }, DELAY_MS)) },
    campaigns: {
      listForUser: vi.fn(() => delayed({ data: [{ id: 'camp-1', name: 'Camp 1' }] }, DELAY_MS)),
      list: vi.fn(() => delayed([{ id: 'camp-1', name: 'Camp 1' }], DELAY_MS)),
    },
    sources: { list: vi.fn(() => delayed([], DELAY_MS)) },
    trends: { list: vi.fn(() => delayed([], DELAY_MS)) },
    keywords: { list: vi.fn(() => delayed([], DELAY_MS)) },
    campaignContent: { list: vi.fn(() => delayed([], DELAY_MS)) },
  };
  return { api };
});

import ScheduledPublications from '@/pages/publish/scheduled';
import Trends from '@/pages/trends';
import Campaigns from '@/pages/campaigns';
import { useCampaignsList } from '@/hooks/use-campaigns';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function snapshot(container: HTMLElement, label: string): string {
  const html = container.innerHTML;
  const lines = [`--- ${label} ---`];
  lines.push(`  h1 present: ${!!container.querySelector('h1')}`);
  lines.push(`  h1 text: ${JSON.stringify(container.querySelector('h1')?.textContent?.trim() || null)}`);
  lines.push(`  any animate-pulse: ${html.includes('animate-pulse')}`);
  lines.push(`  any animate-spin: ${html.includes('animate-spin')}`);
  lines.push(`  scheduled-upcoming-count: ${JSON.stringify(container.querySelector('[data-testid="scheduled-upcoming-count"]')?.textContent || null)}`);
  lines.push(`  scheduled-all-count: ${JSON.stringify(container.querySelector('[data-testid="scheduled-all-count"]')?.textContent || null)}`);
  lines.push(`  trends-loading-placeholder: ${!!container.querySelector('[data-testid="trends-loading-placeholder"]')}`);
  lines.push(`  campaigns-loading-placeholder: ${!!container.querySelector('[data-testid="campaigns-loading-placeholder"]')}`);
  lines.push(`  button-open-create-campaign-dialog: ${!!container.querySelector('[data-testid="button-open-create-campaign-dialog"]')}`);
  lines.push(`  input-search-campaigns: ${!!container.querySelector('[data-testid="input-search-campaigns"]')}`);
  lines.push(`  full-page Loader2 (div.flex.justify-center.p-8 > .h-8.w-8.animate-spin): ${!!container.querySelector('div.flex.justify-center.p-8 > .h-8.w-8.animate-spin')}`);
  return lines.join('\n');
}

describe('AI-86: slow-network browser-equivalent snapshots (5s delay)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scheduled: shell visible during 5s pending, counter shows ... not 0', async () => {
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><ScheduledPublications /></Wrapper>);
    await waitFor(() => {
      expect(screen.getByTestId('scheduled-upcoming-count')).toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="scheduled-upcoming-count"]')?.textContent).toBe('\u2026');
    expect(container.querySelector('[data-testid="scheduled-all-count"]')?.textContent).toBe('\u2026');
    console.log(snapshot(container, 'T+0ms (apiRequest pending, 5s delay)'));
  }, 15000);

  it('trends: h1 visible during 5s pending, no full-page loader, placeholder in data area', async () => {
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Trends /></Wrapper>);
    await new Promise((r) => setTimeout(r, 300));
    expect(container.querySelector('h1')).toBeTruthy();
    expect(container.querySelector('div.flex.justify-center.p-8 > .h-8.w-8.animate-spin')).toBeNull();
    expect(container.querySelector('[data-testid="trends-loading-placeholder"]')).toBeTruthy();
    console.log(snapshot(container, 'T+300ms (user + campaigns queries pending, 5s delay)'));
  }, 15000);

  it('campaigns: h1 + Create button + search visible during isLoading=true', async () => {
    vi.mocked(useCampaignsList).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const Wrapper = makeWrapper();
    const { container } = render(<Wrapper><Campaigns /></Wrapper>);
    await new Promise((r) => setTimeout(r, 300));
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('campaigns.title');
    expect(container.querySelector('[data-testid="button-open-create-campaign-dialog"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="campaigns-loading-placeholder"]')).toBeTruthy();
    console.log(snapshot(container, 'T+300ms (isLoading=true, header still rendered)'));
  }, 15000);
});