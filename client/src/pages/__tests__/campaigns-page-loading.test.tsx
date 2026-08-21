/**
 * AI-86: campaigns list page renders page title and create button during loading.
 *
 * Контрактная красная (shell missing on load):
 *   На медленном соединении `useCampaignsList` в pending, страница `/campaigns`
 *   отдаёт управление `<CampaignsGrid>`, который на `isLoading===true` делает
 *   early-return с собственным Skeleton — при этом **page-level заголовок
 *   «Кампании», кнопка «Создать кампанию» и search-bar не рендерятся**.
 *   Получается пустая область со Skeleton — каркаса раздела нет вообще.
 *
 * Red-before: на main без правки AI-86 `screen.getByRole('heading', { level: 1 })`
 *   во время pending не находится; `data-testid="button-open-create-campaign-dialog"`
 *   тоже отсутствует.
 *   После правки: оба видны с самого начала загрузки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignsList: vi.fn(() => ({
    data: undefined,
    isLoading: true,
    error: null,
  })),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: () => ({ userId: 'u-1', getAuthToken: () => 'token' }),
}));

vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: () => ({
    selectedCampaign: null,
    setSelectedCampaign: () => {},
  }),
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
    useLocation: () => ['/', () => {}],
  };
});

// Dialog stubs — нам они в этом тесте не нужны.
vi.mock('@/components/CampaignForm', () => ({ CampaignForm: () => null }));
vi.mock('@/components/DeleteCampaignConfirmDialog', () => ({ DeleteCampaignConfirmDialog: () => null }));
vi.mock('@/components/EditCampaignDialog', () => ({ EditCampaignDialog: () => null }));
vi.mock('@/components/WelcomeDialog', () => ({ WelcomeDialog: () => null }));

import Campaigns from '@/pages/campaigns';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('AI-86: campaigns page renders shell during initial loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('page title (h1 "Кампании") visible while isLoading is true', async () => {
    render(<Campaigns />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'campaigns.title' })).toBeInTheDocument();
    });
  });

  it('"Create campaign" button visible while isLoading is true', async () => {
    render(<Campaigns />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('button-open-create-campaign-dialog')).toBeInTheDocument();
    });
  });

  it('placeholder list visible in data area while isLoading is true', async () => {
    render(<Campaigns />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('button-open-create-campaign-dialog')).toBeInTheDocument();
    });

    // Должен быть хоть один Skeleton/animate-pulse элемент — placeholder в data-area.
    const placeholder = document.querySelector('.animate-pulse');
    expect(placeholder).not.toBeNull();
  });
});
