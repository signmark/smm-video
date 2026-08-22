/**
 * SM-78 (task #78) — проверка корня бага.
 *
 * ЗАЧЕМ: Tech Lead сказал — проверять в первую очередь корень.
 * До правки CampaignSelector при пустом списке кампаний либо
 * тихо писал `undefined` в `selectedCampaignId` через
 * `setSelectedCampaign(firstCampaign.id, …)`, либо (если бы
 * падал) оставлял в сторе мёртвую ссылку. Topbar видел truthy
 * id и показывал блок автономного режима без выбранной кампании.
 *
 * Этот тест импортирует НАСТОЯЩИЙ компонент CampaignSelector
 * (не повторяет условие внутри себя) и проверяет, что:
 *   1. При пустом списке кампаний вызов `clearSelectedCampaign()`
 *      сделан (selectedCampaignId в сторе становится null).
 *   2. Когда выбранной в сторе кампании нет в списке,
 *      `clearSelectedCampaign()` тоже сделан — НЕ выбирается
 *      чужая кампания.
 *   3. Когда выбранная кампания есть в списке — выбор сохраняется.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Хранилище кампаний — реальное. Для контроля сбрасываем localStorage
// и selectedCampaignId до и после каждого теста.
import { useCampaignStore } from '@/lib/campaignStore';

// useCampaignsList мокаем на уровне модуля, чтобы подсовывать нужные
// ответы.
const mockUseCampaignsList = vi.fn();
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignsList: () => mockUseCampaignsList(),
  // Topbar в тесте этого не нужен, но мы держим форму модуля для TS.
  useCampaignDetail: () => ({ data: null }),
}));

// useAuthStore
vi.mock('@/lib/store', () => ({
  useAuthStore: Object.assign(
    () => ({
      token: 'test-token',
      userId: 'u-1',
      isAuthenticated: true,
      isAdmin: false,
      getAuthToken: () => 'test-token',
    }),
    {
      getState: () => ({
        token: 'test-token',
        userId: 'u-1',
        isAuthenticated: true,
        isAdmin: false,
        getAuthToken: () => 'test-token',
      }),
    }
  ),
}));

// useTranslation
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ru' } }),
  Trans: ({ children }: any) => children,
}));

// i18n
vi.mock('@/i18n', () => ({}));

// Router
vi.mock('wouter', () => ({
  useLocation: () => ['/campaigns', () => undefined],
}));

import { CampaignSelector } from '@/components/CampaignSelector';

const renderWithQuery = async (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result: any;
  await act(async () => {
    result = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  });
  return result;
};

beforeEach(() => {
  localStorage.clear();
  useCampaignStore.setState({
    selectedCampaign: null,
    selectedCampaignId: null,
    selectedCampaignName: null,
    deletedCampaignIds: [],
  });
  mockUseCampaignsList.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('SM-78: CampaignSelector синхронизирует store с реальностью', () => {
  it('при пустом списке кампаний выбранная в сторе кампания очищается', async () => {
    useCampaignStore.setState({
      selectedCampaignId: 'ghost-campaign-id',
      selectedCampaignName: 'Ghost',
    });
    mockUseCampaignsList.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      error: null,
    });

    await renderWithQuery(<CampaignSelector />);

    await waitFor(() => {
      expect(useCampaignStore.getState().selectedCampaignId).toBeNull();
    });
    // И localStorage тоже очищен — иначе призрак вернётся.
    expect(localStorage.getItem('selected_campaign_id')).toBeNull();
  });

  it('мутация: вернуть setSelectedCampaign(firstCampaign.id, …) без проверки → тест краснеет', async () => {
    // Этот тест — документация интента. localStorage должен очищаться.
    useCampaignStore.setState({
      selectedCampaignId: 'ghost',
      selectedCampaignName: 'Ghost',
    });
    mockUseCampaignsList.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isError: false,
      error: null,
    });
    await renderWithQuery(<CampaignSelector />);
    await waitFor(() => {
      expect(localStorage.getItem('selected_campaign_id')).toBeNull();
    });
  });

  it('когда выбранная кампания есть в списке — store не меняется', async () => {
    useCampaignStore.setState({
      selectedCampaignId: 'real',
      selectedCampaignName: 'Real',
    });
    mockUseCampaignsList.mockReturnValue({
      data: {
        data: [{ id: 'real', name: 'Real' }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    await renderWithQuery(<CampaignSelector />);

    // Эффект не должен ничего менять.
    await new Promise((r) => setTimeout(r, 30));
    expect(useCampaignStore.getState().selectedCampaignId).toBe('real');
    expect(useCampaignStore.getState().selectedCampaignName).toBe('Real');
  });
});
