/**
 * SM-18: компонент-уровень тест для предупреждения о неподключённой сети
 * в поле промта в `AutonomousSettings`.
 *
 * Acceptance:
 *  1. Использует тот же список названий, что и
 *     `normalizePlatformMentionsToPlaceholder` (common source);
 *  2. Отрицающий контекст (`не использовать Facebook`) НЕ вызывает warning;
 *  3. Показывает только те сети, что упомянуты положительно И не подключены;
 *  4. Обновляется живьём при смене подключений (testing: меняем `initialSettings`);
 *  5. Это предупреждение, а не блокировка — сохранение не запрещается;
 *  6. JSX-компонентный тест на обычном JSX (после AI-107 это возможно).
 *
 * Red-before: на main без SM-18 фикса warning вообще не рендерится. После —
 * виден. Если бы логика с отрицанием была сломана, тесты с `не используй
 * Facebook` показывали бы ложный warning. Если бы логика с подключением
 * была сломана, тесты с подключённой сетью показывали бы ложный warning.
 *
 * Тест проверяет, что warning присутствует/отсутствует — не зависит
 * от деталей DOM, чтобы не сломаться от CSS-изменений.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AutonomousSettings from '../AutonomousSettings';

// Мокаем модуль напрямую — относительный путь надёжнее, чем алиас в RTL-тестах.
vi.mock('../../lib/queryClient', () => ({
  apiRequest: vi.fn(async () => ({ data: null })),
}));

// Импорт после mock'а — мок должен быть зарегистрирован до него.
import { apiRequest } from '../../lib/queryClient';

const defaultInitialSettings = {
  globalPrompt: '',
  alwaysInclude: '',
  signature: '',
  useEditorPass: false,
  humanize: false,
  adaptForPlatforms: false,
  autoSelectPlatforms: false,
  randomKeywords: false,
  postsPerCycle: 5,
  intervalHours: 24,
  autoSchedule: true,
  withImages: true,
};

const defaultProps = {
  campaignId: 'c-test',
  initialSettings: defaultInitialSettings,
  onSettingsUpdated: () => {},
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Сбрасываем мок apiRequest к дефолтному поведению (campaign null).
  // Без этого после переопределения в одном тесте следующий тест
  // унаследует старый mock — а нам это мешает, потому что mock'нутый
  // social_media_settings на самом деле подключает сети.
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async () => ({ data: null }));
});

describe('SM-18: warning о неподключённой сети в промте', () => {
  it('не показывается, когда промт пуст', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: '' }}
        />
      </Wrapper>,
    );
    expect(screen.queryByTestId('warning-disconnected-platforms')).toBeNull();
  });

  it('не показывается, когда в промте не упомянуты соцсети', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: 'Пиши интересно и с пользой.' }}
        />
      </Wrapper>,
    );
    expect(screen.queryByTestId('warning-disconnected-platforms')).toBeNull();
  });

  it('red-before: показывается, когда в промте упомянута неподключённая сеть', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: 'Пиши в Telegram и Facebook' }}
        />
      </Wrapper>,
    );
    // mock API возвращает пустой campaign → connectedPlatforms=[].
    // Facebook упомянут и не подключён → warning есть.
    const warn = screen.getByTestId('warning-disconnected-platforms');
    expect(warn).toBeInTheDocument();
    expect(warn.textContent).toContain('Facebook');
  });

  it('НЕ показывается, если все упомянутые сети подключены', () => {
    // Прямая замена mock'а для этого теста.
    // SM-24: telegram требует chatId И токен (hasToken:true), иначе
    // числится неподключённым.
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async () => ({
      data: {
        social_media_settings: {
          telegram: { chatId: '-100123', hasToken: true },
          facebook: { pageId: '12345' },
        },
      },
    }));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: 'Пиши в Telegram и Facebook' }}
        />
      </Wrapper>,
    );
    // The component fetches campaign via useEffect on mount. Wait for it.
    // We want to assert no warning AFTER the fetch resolves.
    // QueryClient returns the mocked data; React updates `connectedPlatforms`.
    // Wait for the effect to complete; then assert.
    return (async () => {
      // microtask + small timeout
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('warning-disconnected-platforms')).toBeNull();
    })();
  });

  it('НЕ показывается, если обе упомянутые сети в отрицающем контексте', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: 'Не пиши в Telegram, не используй Facebook' }}
        />
      </Wrapper>,
    );
    expect(screen.queryByTestId('warning-disconnected-platforms')).toBeNull();
  });

  it('red-before: показывает только positive-упоминания (mixed)', () => {
    // Facebook в отрицании, Telegram и YouTube — положительно.
    // Все три не подключены (mock возвращает пустоту). Должны быть
    // только Telegram и YouTube — НЕ Facebook.
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AutonomousSettings
          {...defaultProps}
          initialSettings={{ ...defaultInitialSettings, globalPrompt: 'Пиши в Telegram и YouTube, но не пиши в Facebook' }}
        />
      </Wrapper>,
    );
    const warn = screen.queryByTestId('warning-disconnected-platforms');
    expect(warn).toBeInTheDocument();
    expect(warn!.textContent).toContain('Telegram');
    expect(warn!.textContent).toContain('YouTube');
    expect(warn!.textContent).not.toContain('Facebook');
  });
});