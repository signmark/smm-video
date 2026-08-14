/**
 * SM-24: отказ сервера по полю «ID чата» должен быть виден у самого поля.
 *
 * Живая цепочка: пользователь вводит некорректный ID чата → «Сохранить» →
 * сервер отвечает 400 → react-hook-form setError → FormMessage рисует подпись
 * у поля telegram.chatId, связанную с полем через aria-describedby.
 *
 * Почему тест переписан. Прежняя версия подкладывала ошибку вида
 * `error.response.data.error` — такой формы клиент не создаёт никогда:
 * `throwIfResNotOk` (client/src/lib/queryClient.ts) кладёт в `error.response`
 * только `{ status, statusText }`, а текст сервера оставляет в `error.message`.
 * Тест был зелёным, а на живом проде подписи у поля не появлялось: проверялась
 * форма ошибки, которой не существует. Теперь основной случай — ровно та форма,
 * которую строит транспорт, и отдельным случаем проверена совместимость со
 * старой формой с телом ответа.
 *
 * Проверяется:
 *  1. реальная форма ошибки транспорта → подпись у поля и aria-связь;
 *  2. подпись человеческая и по-русски, англоязычный ответ сервера пользователю
 *     не показывается;
 *  3. токен, введённый в форму, в разметку не попадает;
 *  4. форма ошибки с телом ответа тоже даёт подпись у поля;
 *  5. чужая 400-ошибка не вешается на поле ID чата, но отправка формы была;
 *  6. успешное сохранение остаётся успешным.
 *
 * Attributable red: убрать сопоставление ошибки с полем `telegram.chatId`
 * в SocialMediaSettings — падают случаи 1, 2 и 4; убрать чтение текста из
 * `error.message` — падают 1 и 2.
 *
 * Требует JSX-инфраструктуру AI-107.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ─── Silence unhandled background fetch errors (jsdom has no URL base) ─────

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

const SERVER_TEXT = 'Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link';
const TOKEN = 'секрет-который-не-должен-утечь-в-разметку';

let qc: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function renderComponent(onSettingsUpdated = vi.fn()) {
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(SocialMediaSettings, {
        campaignId: 'test-campaign-1',
        initialSettings: {},
        onSettingsUpdated,
      }),
    ),
  );
  return { onSettingsUpdated };
}

// Ровно то, что строит throwIfResNotOk: текст сервера в message, тела ответа нет.
function transportError(text: string) {
  const e: any = new Error(text);
  e.status = 400;
  e.response = { status: 400, statusText: 'Bad Request' };
  e.config = { url: '/api/campaigns/test-campaign-1' };
  return e;
}

// Старая форма с телом ответа — оставлена для совместимости.
function bodyError(text: string) {
  const e: any = new Error(text);
  e.response = { status: 400, data: { error: text } };
  return e;
}

async function openTelegramAndSave(user: ReturnType<typeof userEvent.setup>, chatId: string, withToken = false) {
  await user.click(screen.getByText('Telegram'));
  const chatIdInput = screen.getByPlaceholderText('Например: -1001234567890 или @channel_name');
  if (withToken) {
    await user.type(screen.getByPlaceholderText('Введите токен бота'), TOKEN);
  }
  await user.clear(chatIdInput);
  if (chatId) await user.type(chatIdInput, chatId);
  await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
  return chatIdInput;
}

describe('SM-24: отказ сервера по ID чата доходит до поля', () => {
  it('ошибка в форме транспорта: подпись у поля, по-русски, с aria-связью', async () => {
    (apiRequest as any).mockRejectedValueOnce(transportError(SERVER_TEXT));
    renderComponent();
    const user = userEvent.setup();
    const chatIdInput = await openTelegramAndSave(user, 'someone@example.com', true);

    const errorNode = await screen.findByText(/ID чата/);
    expect(errorNode).toBeInTheDocument();
    // Пользователю показываем человеческий текст, а не ответ сервера.
    expect(screen.queryByText(/Invalid Telegram chat ID/)).toBeNull();

    expect(chatIdInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = chatIdInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(errorNode.id).toBeTruthy();
    expect(describedBy).toContain(errorNode.id);

    // Введённый токен нигде в разметке не появляется.
    expect(document.body.textContent || '').not.toContain(TOKEN);
  });

  it('ошибка с телом ответа тоже доходит до поля', async () => {
    (apiRequest as any).mockRejectedValueOnce(bodyError(SERVER_TEXT));
    renderComponent();
    const user = userEvent.setup();
    const chatIdInput = await openTelegramAndSave(user, 'someone@example.com');

    await screen.findByText(/ID чата/);
    expect(chatIdInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('чужая 400-ошибка не вешается на поле ID чата, но отправка была', async () => {
    (apiRequest as any).mockRejectedValueOnce(transportError('Campaign name cannot be empty'));
    renderComponent();
    const user = userEvent.setup();

    await user.click(screen.getByText('Telegram'));
    await user.click(screen.getByRole('button', { name: 'Сохранить настройки' }));

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith('/api/campaigns/test-campaign-1',
      expect.objectContaining({ method: 'PATCH' }));

    await waitFor(() => {
      expect(screen.queryByText(/ID чата\./)).toBeNull();
    });
  });

  it('успешное сохранение остаётся успешным: подписи нет, родитель уведомлён', async () => {
    (apiRequest as any).mockResolvedValueOnce({ data: { id: 'test-campaign-1' } });
    const { onSettingsUpdated } = renderComponent();
    const user = userEvent.setup();
    const chatIdInput = await openTelegramAndSave(user, '@valid_channel_name', true);

    await waitFor(() => expect(onSettingsUpdated).toHaveBeenCalled());
    expect(chatIdInput).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/Неверный ID чата/)).toBeNull();
  });
});
