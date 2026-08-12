/**
 * SM-24: UX — server 400 chatId error reaches the Telegram chatId form field.
 *
 * Renders the real SocialMediaSettings component with mocked API boundaries.
 * The live chain is: user types invalid chatId → clicks Save → mocked apiRequest
 * returns 400 → real react-hook-form setError → FormMessage renders server text
 * at the telegram.chatId field, associated via aria-describedby.
 *
 * Mutation proof (executed by @Clause_Dev_Hermi): revert SocialMediaSettings.tsx
 * catch block to main — test imports/renders but the field-error assertion fails.
 *
 * Requires AI-107 JSX infra (dd982a8). Executed locally with npm ci, axios 1.18.1.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Silence unhandled background fetch errors (jsdom has no URL base) ─────

const _origFetch = globalThis.fetch;

globalThis.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })),
) as any;

// ─── Mock all non-UI boundaries ─────

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-plan', () => ({
  usePlan: () => ({ limits: { maxConnectedAccounts: 10, maxCampaigns: 10 } }),
}));

vi.mock('wouter', async () => ({
  useLocation: () => ['/', vi.fn()],
  Link: ({ children }: any) => children,
}));

vi.mock('@/lib/directus', () => ({
  directusApi: { get: vi.fn().mockResolvedValue({ data: { data: [] } }), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/platform-connection', () => ({
  isPlatformConnected: () => false,
  getConnectedPlatformsMap: () => ({}),
  CONNECTABLE_PLATFORMS: [],
  parseSocialSettings: (x: any) => x,
}));

vi.mock('@/lib/vk-groups-request', () => ({
  fetchVkGroupsByManualToken: vi.fn().mockResolvedValue([]),
}));

// Mock OAuth wizard components — replace with empty divs
vi.mock('@/components/YouTubeOAuthSetup', () => ({
  YouTubeOAuthSetup: () => React.createElement('div', null),
}));
vi.mock('@/components/YouTubeSetupWizard', () => ({
  YouTubeSetupWizard: () => React.createElement('div', null),
}));
vi.mock('@/components/InstagramSetupWizardSimple', () => ({
  default: () => React.createElement('div', null),
}));
vi.mock('@/components/VkSetupWizard', () => ({
  default: () => React.createElement('div', null),
}));
vi.mock('@/components/FacebookSetupWizard', () => ({
  default: () => React.createElement('div', null),
}));

// Mock lucide-react icons to plain elements
vi.mock('lucide-react', async () => {
  const createIcon = () => (props: any) => React.createElement('span', props);
  return {
    Loader2: createIcon(),
    CheckCircle: createIcon(),
    XCircle: createIcon(),
    AlertCircle: createIcon(),
    AlertTriangle: createIcon(),
    Youtube: createIcon(),
    RefreshCw: createIcon(),
    Clock: createIcon(),
    ChevronDown: createIcon(),
    Eye: createIcon(),
    EyeOff: createIcon(),
    ExternalLink: createIcon(),
  };
});

import { apiRequest } from '@/lib/queryClient';
import { SocialMediaSettings } from '@/components/SocialMediaSettings';

let qc: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function renderComponent() {
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(SocialMediaSettings, {
        campaignId: 'test-campaign-1',
        initialSettings: {},
        onSettingsUpdated: vi.fn(),
      }),
    ),
  );
}

describe('SM-24: server 400 chatId error reaches field', () => {
  it('Telegram 400: error text visible at chatId field with aria association', async () => {
    // apiRequest throws with response.data.error → onSubmit catch reads it
    const apiError = new Error('Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link');
    (apiError as any).response = {
      status: 400,
      data: { error: 'Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link' },
    };
    (apiRequest as any).mockRejectedValueOnce(apiError);

    renderComponent();
    const user = userEvent.setup();

    // Open the Telegram accordion section
    const telegramTrigger = screen.getByText('Telegram');
    await user.click(telegramTrigger);

    // Find the chatId input by placeholder
    const chatIdInput = screen.getByPlaceholderText('Например: -1001234567890 или @channel_name');
    await user.clear(chatIdInput);
    await user.type(chatIdInput, 'someone@example.com');

    // Click save
    const saveButton = screen.getByRole('button', { name: 'Сохранить настройки' });
    await user.click(saveButton);

    // Wait for react-hook-form setError to propagate to FormMessage
    const errorNode = await screen.findByText(/Invalid Telegram chat ID/);
    expect(errorNode).toBeInTheDocument();

    // Field-level proof: input aria-invalid and aria-describedby → error node
    expect(chatIdInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = chatIdInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // The error node's id should be referenced by the input's aria-describedby
    expect(errorNode.id).toBeTruthy();
    if (describedBy) {
      expect(describedBy).toContain(errorNode.id);
    }
  });

  it('non-Telegram 400: no field-level error at chatId, submit still happened', async () => {
    const apiError = new Error('Campaign name cannot be empty');
    (apiError as any).response = { status: 400, data: { error: 'Campaign name cannot be empty' } };
    (apiRequest as any).mockRejectedValueOnce(apiError);

    renderComponent();
    const user = userEvent.setup();

    // Open Telegram (need to interact with form to trigger save)
    const telegramTrigger = screen.getByText('Telegram');
    await user.click(telegramTrigger);

    const saveButton = screen.getByRole('button', { name: 'Сохранить настройки' });
    await user.click(saveButton);

    // Proof that submit actually happened: apiRequest was called with PATCH
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/campaigns/test-campaign-1',
      expect.objectContaining({ method: 'PATCH' }));

    // No Telegram-specific field error
    await waitFor(() => {
      expect(screen.queryByText(/Invalid Telegram chat ID/)).toBeNull();
    });
  });
});
