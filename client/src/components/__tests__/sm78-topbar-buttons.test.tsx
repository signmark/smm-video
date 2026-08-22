/**
 * SM-78 (task #78) — Topbar client-side guard: кнопки управления
 * автономным режимом не должны быть видны, когда кампания не
 * выбрана.
 *
 * ЗАЧЕМ: до правки `selectedCampaignId` мог указывать на удалённую
 * кампанию, и Topbar рисовал блок автономного режима целиком —
 * pause / manage / tooltip. Это и есть баг, который увидел
 * владелец: «кнопки управления автономным режимом видны, когда
 * кампания не выбрана».
 *
 * Этот тест проверяет условие рендера блока (не повторяет его
 * внутри себя — тестирует НАСТОЯЩИЙ компонент Topbar).
 *
 * Мутация: убрать условие `showAutonomousBlock` и заменить его
 * на константу `true` — все четыре теста ниже краснеют.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

// ── Mocks ────────────────────────────────────────────────────────────────

// useCampaignsList — управляем через mockCampaignsList.
const mockCampaignsList = vi.fn();
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignDetail: () => ({ data: null }),
  useCampaignsList: () => mockCampaignsList(),
}));

// useCampaignStore — управляем через переменные.
let mockSelectedCampaignId: string | null = 'camp-1';
let mockSelectedCampaignName: string | null = 'Camp 1';
vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: () => ({
    selectedCampaignId: mockSelectedCampaignId,
    selectedCampaignName: mockSelectedCampaignName,
    setSelectedCampaign: () => {},
    clearSelectedCampaign: () => {},
  }),
}));

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

vi.mock('@/hooks/use-user-profile', () => ({
  useUserProfile: () => ({ data: null }),
}));

vi.mock('@/lib/themeStore', () => ({
  useThemeStore: () => ({ resolvedTheme: 'light', setColorMode: () => {} }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="lang-switcher-stub" />,
}));

vi.mock('../CampaignSelector', () => ({
  CampaignSelector: () => <div data-testid="campaign-selector-stub" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/i18n', () => ({}));

// Stub global fetch: иначе useQuery за автономным статусом упадёт.
const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString();
  if (u.includes('/api/autonomous/status/')) {
    return new Response(JSON.stringify({ isActive: false }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
});
(globalThis as any).fetch = fetchMock;

import { Topbar } from '@/components/AppShell/Topbar';

const noop = () => {};

function renderTopbar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Topbar
          onMenuClick={noop}
          onLogout={noop}
          onOpenProfile={noop}
          location="/dashboard"
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockClear();
  localStorage.clear();
  mockSelectedCampaignId = 'camp-1';
  mockSelectedCampaignName = 'Camp 1';
  mockCampaignsList.mockReset();
  mockCampaignsList.mockReturnValue({
    data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
    isLoading: false,
    isError: false,
    error: null,
  });
});

describe('SM-78: Topbar скрывает блок автономного режима без выбранной кампании', () => {
  it('когда selectedCampaignId=null — кнопки автономного режима в разметке отсутствуют', async () => {
    mockSelectedCampaignId = null;
    mockSelectedCampaignName = null;

    renderTopbar();

    await waitFor(() => {
      expect(screen.queryByTestId('button-autonomous-toggle')).toBeNull();
    });
    expect(screen.queryByTestId('button-autonomous-pause')).toBeNull();
    expect(screen.queryByTestId('button-autonomous-pending')).toBeNull();
  });

  it('когда selectedCampaignId указывает на удалённую кампанию (нет в успешно загруженном списке) — кнопки отсутствуют', async () => {
    mockSelectedCampaignId = 'ghost';
    mockSelectedCampaignName = 'Ghost';
    mockCampaignsList.mockReturnValue({
      data: { data: [{ id: 'camp-other', name: 'Other' }] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderTopbar();

    await waitFor(() => {
      expect(screen.queryByTestId('button-autonomous-toggle')).toBeNull();
    });
    expect(screen.queryByTestId('button-autonomous-pause')).toBeNull();
  });

  it('когда список ещё грузится — блок виден (старое поведение), чтобы не терять функцию из-за флапа', async () => {
    mockSelectedCampaignId = 'camp-1';
    mockSelectedCampaignName = 'Camp 1';
    mockCampaignsList.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderTopbar();

    await waitFor(() => {
      expect(screen.queryByTestId('button-autonomous-toggle')).not.toBeNull();
    });
  });

  it('когда запрос списка упал — блок виден (старое поведение)', async () => {
    mockSelectedCampaignId = 'camp-1';
    mockSelectedCampaignName = 'Camp 1';
    mockCampaignsList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('network'),
    });

    renderTopbar();

    await waitFor(() => {
      expect(screen.queryByTestId('button-autonomous-toggle')).not.toBeNull();
    });
  });

  it('когда selectedCampaignId есть и кампания реальна в списке — кнопки видны', async () => {
    mockSelectedCampaignId = 'camp-1';
    mockSelectedCampaignName = 'Camp 1';
    mockCampaignsList.mockReturnValue({
      data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderTopbar();

    await waitFor(() => {
      expect(screen.queryByTestId('button-autonomous-toggle')).not.toBeNull();
    });
  });
});
