/**
 * AI-86: scheduled counters hide zero during initial loading.
 *
 * Контрактная красная (точный баг со скрина владельца 08.08):
 *   1. До завершения запроса `scheduled-upcoming-count` и `scheduled-all-count`
 *      показывают `…`, не `0` — иначе UI говорит «записей 0» и «идёт загрузка»
 *      в один момент.
 *   2. После успешного ответа счётчики показывают настоящие числа,
 *      включая 0 для пустого ответа (это утверждение о данных, не
 *      неизвестность).
 *   3. Empty состояние для upcoming сохраняется как реальный «0».
 *
 * Red-before: на main без правки AI-86 оба счётчика показывают `0`
 * одновременно со Skeleton в data-area. После правки — `…`.
 *
 * Примечание: `scheduled-overdue-count` намеренно не проверяем — он
 * отрисовывается только когда есть просроченные/бездатые записи; до
 * ответа этой секции в DOM нет. Это нормально по контракту (loading
 * и empty — разные состояния).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignsList: vi.fn(() => ({
    data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
    isLoading: false,
  })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => null,
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: (selector) => {
    const state = { userId: 'u-1', getAuthToken: () => 'token' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: (selector) => {
    const state = { selectedCampaign: { id: 'camp-1', name: 'Camp 1' } };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/lib/content-cache-updates', () => ({
  updateContentCachesAfterMoveToDraft: vi.fn(),
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
  };
});

vi.mock('@/components/ScheduledPublicationDetails', () => ({
  default: ({ content }) => <div data-testid={`pub-card-${content.id}`}>{content.title}</div>,
}));

import ScheduledPublications from '@/pages/publish/scheduled';
import { apiRequest } from '@/lib/queryClient';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AI-86: scheduled counters hide zero during initial loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scheduled-upcoming-count shows "..." while request is pending', async () => {
    let resolveRequest;
    vi.mocked(apiRequest).mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(<ScheduledPublications />, { wrapper: makeWrapper() });

    const upcoming = await screen.findByTestId('scheduled-upcoming-count');
    expect(upcoming.textContent).toBe('\u2026');

    resolveRequest({ data: [] });
  });

  it('scheduled-all-count in Select shows "..." while request is pending', async () => {
    let resolveRequest;
    vi.mocked(apiRequest).mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(<ScheduledPublications />, { wrapper: makeWrapper() });

    const allCount = await screen.findByTestId('scheduled-all-count');
    expect(allCount.textContent).toBe('\u2026');

    resolveRequest({ data: [] });
  });

  it('scheduled-upcoming-count shows real 0 on empty response', async () => {
    vi.mocked(apiRequest).mockImplementation(
      async () => ({ data: [] }),
    );

    render(<ScheduledPublications />, { wrapper: makeWrapper() });

    const upcoming = await screen.findByTestId('scheduled-upcoming-count');
    await waitFor(() => expect(upcoming.textContent).toBe('0'));

    const allCount = await screen.findByTestId('scheduled-all-count');
    expect(allCount.textContent).toBe('0');
  });

  it('scheduled-upcoming-count shows real number on data response', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    vi.mocked(apiRequest).mockImplementation(
      async () => ({
        data: [
          { id: 'c-1', title: 'Future post', status: 'scheduled', scheduledAt: future, socialPlatforms: { telegram: { status: 'scheduled' } } },
          { id: 'c-2', title: 'Another future post', status: 'scheduled', scheduledAt: future, socialPlatforms: { telegram: { status: 'scheduled' } } },
        ],
      }),
    );

    render(<ScheduledPublications />, { wrapper: makeWrapper() });

    const upcoming = await screen.findByTestId('scheduled-upcoming-count');
    await waitFor(() => expect(upcoming.textContent).toBe('2'));
  });

  it('counter shows "\u2014" (em-dash) on error response, not a number', async () => {
    vi.mocked(apiRequest).mockImplementation(
      async () => {
        throw new Error('network down');
      },
    );

    render(<ScheduledPublications />, { wrapper: makeWrapper() });

    const upcoming = await screen.findByTestId('scheduled-upcoming-count');
    // На отказ счётчик показывает «—», а не «…» и не число.
    await waitFor(() => expect(upcoming.textContent).toBe('\u2014'));

    const allCount = await screen.findByTestId('scheduled-all-count');
    expect(allCount.textContent).toBe('\u2014');
  });
});
