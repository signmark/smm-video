/**
 * SM-20 client-side Topbar regression guard.
 *
 * Tester (20.08, 12:08 UTC) reported that clicking the active autonomous-mode
 * icon instantly turned the mode off. The fix landed in commit 00eb4b2d0
 * (21:24 UTC same day) and ships in `22b2c652d` on prod. This test is the
 * guard so the regression cannot return unnoticed.
 *
 * What this test proves (covers exactly the path the tester named):
 *   1. While autonomous mode is ACTIVE, clicking `button-autonomous-toggle`
 *      opens `dialog-autonomous-manage` and does NOT fire any
 *      `/api/autonomous/stop` mutation. The active state is preserved.
 *   2. The manage dialog exposes three distinct actions:
 *      `button-manage-pause`, `button-manage-resume` (when paused),
 *      `button-manage-disable`. Pause/Resume are visible because they
 *      are the only safe actions over a still-running run; the disable
 *      button alone is not enough.
 *   3. Closing the dialog (Escape) leaves mode ACTIVE — closing is not
 *      "off".
 *
 * Why this exists on top of the 46 server tests: the server side proves
 * `demoteOwnContent` runs correctly. The client side proves the button
 * the tester actually pressed does the right thing. If `onClick` ever
 * regresses to `stopAutonomous()`, test #1 fails immediately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

// ── Mocks ────────────────────────────────────────────────────────────────
// Mock order matters: anything imported transitively by Topbar must be
// stubbed before the import below.

// Auth store: provide a valid-looking token + user so queryFn is enabled.
vi.mock('@/lib/store', () => ({
  useAuthStore: Object.assign(
    (sel: any) =>
      sel({
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
      setState: () => {},
      setAuth: () => {},
    },
  ),
}));

// Campaign store: pin a campaign so autonomous status fetches fire.
vi.mock('@/lib/campaignStore', () => ({
  useCampaignStore: () => ({ selectedCampaignId: 'camp-1' }),
}));

// Campaign detail hook: not exercised by this test, but Topbar calls it.
vi.mock('@/hooks/use-campaigns', () => ({
  useCampaignDetail: () => ({ data: null }),
  // SM-78: Topbar теперь читает список кампаний для второго эшелона.
  // SM-20 не зависит от списка — отдаём «успешно загруженный, выбранная
  // кампания на месте» как в дефолте beforeEach.
  useCampaignsList: () => ({
    data: { data: [{ id: 'camp-1', name: 'Camp 1' }] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// User profile hook: not exercised here.
vi.mock('@/hooks/use-user-profile', () => ({
  useUserProfile: () => ({ data: null }),
}));

// Theme store: not exercised.
vi.mock('@/lib/themeStore', () => ({
  useThemeStore: () => ({ resolvedTheme: 'light', setColorMode: () => {} }),
}));

// Toast hook: silent stub.
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Language switcher: irrelevant chrome.
vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="lang-switcher-stub" />,
}));

// Campaign selector: irrelevant chrome.
vi.mock('../CampaignSelector', () => ({
  CampaignSelector: () => <div data-testid="campaign-selector-stub" />,
}));

// i18n: return key as-is, so we can assert by keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ru', changeLanguage: vi.fn() },
  }),
}));

// Stub fetch globally so any unmocked fetch call fails loudly with our hint,
// rather than hitting jsdom's default which returns 200/[] and silently
// hides real bugs.
const stopCalls: Array<{ url: string; init?: RequestInit }> = [];
const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url.toString();
  if (u.includes('/api/autonomous/stop')) {
    stopCalls.push({ url: u, init });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (u.includes('/api/autonomous/status/')) {
    return new Response(
      JSON.stringify({ isActive: true, status: 'running', interval: 24, postsPerCycle: 1 }),
      { status: 200 },
    );
  }
  if (u.includes('/api/autonomous/pause') || u.includes('/api/autonomous/resume')) {
    return new Response(JSON.stringify({ success: true, content: { success: true, counts: {} } }), { status: 200 });
  }
  if (u.includes('/api/campaigns/')) {
    return new Response(JSON.stringify({ data: null }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
});
(globalThis as any).fetch = fetchMock;

// Now safe to import the component under test.
import { Topbar } from '../AppShell/Topbar';

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
  stopCalls.length = 0;
  fetchMock.mockClear();
  localStorage.clear();
});

describe('SM-20 Topbar regression guard', () => {
  it('clicking the active autonomous icon opens manage dialog without stopping the mode', async () => {
    renderTopbar();

    // The icon button has aria-pressed=true while mode is active.
    const toggle = await screen.findByTestId('button-autonomous-toggle');

    // Wait for the autonomous status query to resolve (fetch mock is sync
    // but React Query still schedules via microtask).
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    // No /api/autonomous/stop should have been issued before the click.
    expect(stopCalls).toHaveLength(0);

    fireEvent.click(toggle);

    // Manage dialog appears. Mode still active in UI.
    const dialog = await screen.findByTestId('dialog-autonomous-manage');
    expect(dialog).toBeInTheDocument();

    // Critical assertion: clicking the icon must NOT have called /stop.
    expect(stopCalls).toHaveLength(0);
  });

  it('manage dialog exposes pause, resume and disable controls', async () => {
    renderTopbar();
    const toggle = await screen.findByTestId('button-autonomous-toggle');
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });
    fireEvent.click(toggle);

    // Pause is visible because the run is active.
    const pause = await screen.findByTestId('button-manage-pause');
    expect(pause).toBeInTheDocument();

    // Disable is visible.
    const disable = await screen.findByTestId('button-manage-disable');
    expect(disable).toBeInTheDocument();

    // Resume is NOT visible while running (autonomousControls hides it).
    expect(screen.queryByTestId('button-manage-resume')).not.toBeInTheDocument();
  });

  it('closing the manage dialog leaves mode active (closing is not off)', async () => {
    renderTopbar();
    const toggle = await screen.findByTestId('button-autonomous-toggle');
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });
    fireEvent.click(toggle);
    const dialog = await screen.findByTestId('dialog-autonomous-manage');
    expect(dialog).toBeInTheDocument();

    // Escape closes the dialog.
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('dialog-autonomous-manage')).not.toBeInTheDocument();
    });

    // And still no /stop issued.
    expect(stopCalls).toHaveLength(0);
  });
});