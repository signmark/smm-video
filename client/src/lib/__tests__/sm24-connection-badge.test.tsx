/**
 * SM-24: метка «Настроено» показывает СОХРАНЁННОЕ состояние, а токен можно снять.
 *
 * Что находили живые люди (тестирование 18.08):
 *  - одного символа в поле «ID чата» хватало, чтобы загорелась метка
 *    «Настроено» — до сохранения и до любой проверки;
 *  - стёртый токен не сохранялся: после перезагрузки он был на месте, и
 *    отключить Telegram из интерфейса было невозможно вовсе;
 *  - браузер подставлял почту в «ID чата» при замене токена.
 *
 * Причина первых двух — одна и та же: интерфейс считал состояние по форме
 * (form.getValues()), а не по тому, что действительно сохранено, и не имел
 * способа выразить намерение «снять».
 *
 * Attributable red:
 *  - вернуть form.getValues() в isConfigured — падают случаи 1 и 2;
 *  - убрать кнопку «Удалить токен» или флаг hasToken:false — падают 3 и 4;
 *  - убрать autoComplete="new-password" у поля токена — падает 5.
 *
 * Требует JSX-инфраструктуру AI-107.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

globalThis.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })),
) as any;

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({ success: true }),
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

// lib/platform-connection НЕ мокаем намеренно: правило «что считается
// подключённым» — часть проверяемого поведения.

vi.mock('@/lib/vk-groups-request', () => ({
  fetchVkGroupsByManualToken: vi.fn().mockResolvedValue([]),
}));

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

// Ровно то, что доезжает до браузера: сам токен вырезан, остался признак.
const SAVED_TELEGRAM = { telegram: { chatId: '@channel', hasToken: true } };

let qc: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  (apiRequest as any).mockResolvedValue({ success: true });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function renderComponent(initialSettings: any, onSettingsUpdated = vi.fn()) {
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(SocialMediaSettings, {
        campaignId: 'test-campaign-1',
        initialSettings,
        onSettingsUpdated,
      }),
    ),
  );
  return { onSettingsUpdated };
}

describe('SM-24: метка «Настроено» и снятие токена Telegram', () => {
  it('метка стоит по сохранённым настройкам', () => {
    renderComponent(SAVED_TELEGRAM);
    expect(screen.getByText('Настроено')).toBeInTheDocument();
  });

  it('набранный, но не сохранённый ID чата метку не зажигает', async () => {
    // Находка тестировщика: при сохранённом токене хватало одного символа в
    // поле «ID чата» — метка загоралась мгновенно, до сохранения. Человек
    // видел «Настроено» там, где публикация не пройдёт.
    renderComponent({ telegram: { hasToken: true } });
    const user = userEvent.setup();

    expect(screen.queryByText('Настроено')).toBeNull();

    await user.click(screen.getByText('Telegram'));
    await user.type(screen.getByPlaceholderText('Например: -1001234567890 или @channel_name'), '@channel');

    expect(screen.queryByText('Настроено')).toBeNull();
  });

  it('набранный, но не сохранённый токен метку тоже не зажигает', async () => {
    // Зеркальный случай: сохранён ID чата, человек вводит токен. До
    // сохранения площадка не подключена — на сервере токена ещё нет.
    renderComponent({ telegram: { chatId: '@channel' } });
    const user = userEvent.setup();

    await user.click(screen.getByText('Telegram'));
    await user.type(screen.getByPlaceholderText('Введите токен бота'), '123:abc');

    expect(screen.queryByText('Настроено')).toBeNull();
  });

  it('«Удалить токен» отправляет намерение снять секрет, а не пустое значение', async () => {
    const { onSettingsUpdated } = renderComponent(SAVED_TELEGRAM);
    const user = userEvent.setup();

    await user.click(screen.getByText('Telegram'));
    await user.click(screen.getByTestId('button-telegram-remove-token'));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith('/api/campaigns/test-campaign-1', {
      method: 'PATCH',
      data: { social_media_settings: { telegram: { hasToken: false } } },
    });
    // Метку рисует сохранённое состояние — значит его надо перечитать.
    await waitFor(() => expect(onSettingsUpdated).toHaveBeenCalled());
  });

  it('снятие не трогает ID чата: удаляют токен, а не всю настройку', async () => {
    renderComponent(SAVED_TELEGRAM);
    const user = userEvent.setup();

    await user.click(screen.getByText('Telegram'));
    await user.click(screen.getByTestId('button-telegram-remove-token'));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const sent = (apiRequest as any).mock.calls[0][1].data.social_media_settings.telegram;
    expect(sent).not.toHaveProperty('chatId');
    expect(sent).not.toHaveProperty('token');
  });

  it('поле токена не выглядит для браузера полем входа', async () => {
    // Иначе браузер считает пару «текстовое поле + пароль» формой логина и
    // подставляет сохранённую почту в соседнее поле — в «ID чата».
    renderComponent({});
    const user = userEvent.setup();

    await user.click(screen.getByText('Telegram'));
    const token = screen.getByPlaceholderText('Введите токен бота');

    expect(token).toHaveAttribute('type', 'password');
    expect(token).toHaveAttribute('autocomplete', 'new-password');
  });
});
