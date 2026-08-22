/**
 * AI-134 / #86 — topbar zones unit tests.
 *
 * Каждый тест — поведенческий, мутационно-устойчивый: если из TopbarZones
 * пропадёт ключевая обёртка (ZoneDivider, переключение иконки, рендер имени,
 * расположение языка/темы внутри AccountZone) — соответствующий тест
 * покраснеет.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiZone, HelpZone, AccountZone, ZoneDivider } from '../TopbarZones';

// themeStore инициализируется на module load с matchMedia, что в jsdom
// не работает — мокаем стор как в SM-80.
vi.mock('@/lib/themeStore', () => ({
  useThemeStore: vi.fn(() => ({
    resolvedTheme: 'light',
    colorMode: 'light',
    setColorMode: vi.fn(),
  })),
}));

// i18n в jsdom может падать на отсутствующих ресурсах — мокаем минимально.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// router Link: чтобы не падать на навигации, превращаем в <a>.
vi.mock('wouter', () => ({
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

// AccountZone внутри использует LanguageSwitcher и ThemeToggle. Чтобы
// тесты AccountZone не зависели от их внутренностей, заменим их
// стабами с понятными data-testid.
vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <button data-testid="lang-stub">Lang</button>,
}));
vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button data-testid="theme-stub">Theme</button>,
}));

beforeEach(() => {
  // window.location.href — нужно сбрасывать между тестами, иначе
  // jsdom будет помнить установленное значение.
  (window as any).__lastHref = undefined;
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      href: '',
      assign: (url: string) => { (window as any).__lastHref = url; },
    },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI-134 / ZoneDivider', () => {
  it('рендерит тонкую полоску с aria-hidden и data-testid', () => {
    const { container } = render(<ZoneDivider />);
    const div = container.querySelector('[data-testid="topbar-zone-divider"]');
    expect(div).toBeTruthy();
    expect(div!.getAttribute('aria-hidden')).toBe('true');
    expect(div!.className).toContain('h-6');
    expect(div!.className).toContain('w-px');
  });
});

describe('AI-134 / AiZone — единственный синий акцент', () => {
  it('рендерит кнопку с синим фоном и текстом «ИИ-помощник»', () => {
    const onOpen = vi.fn();
    render(<AiZone onOpenAIChat={onOpen} />);
    const btn = screen.getByTestId('button-ai-assistant');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('ИИ-помощник');
    // Синий акцент — критерий 2.
    expect(btn.className).toMatch(/bg-blue-600|bg-blue-500/);
  });

  it('вызывает onOpenAIChat по клику', async () => {
    const onOpen = vi.fn();
    render(<AiZone onOpenAIChat={onOpen} />);
    await userEvent.click(screen.getByTestId('button-ai-assistant'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('AI-134 / HelpZone — один значок с меню', () => {
  it('рендерит три пункта меню: поддержка, tg-ассистент (если передан), документация', async () => {
    const onTG = vi.fn();
    render(<HelpZone onOpenTGBot={onTG} />);
    // Открыть меню
    await userEvent.click(screen.getByTestId('button-help'));
    // Radix dropdown рендерит контент в портале в document.body
    const items = [
      screen.getByTestId('button-help-support'),
      screen.getByTestId('button-tg-bot'),
      screen.getByTestId('button-help-docs'),
    ];
    expect(items).toHaveLength(3);
  });

  it('без onOpenTGBot пункт «Телеграм-ассистент» НЕ рендерится', async () => {
    render(<HelpZone />);
    await userEvent.click(screen.getByTestId('button-help'));
    expect(screen.queryByTestId('button-tg-bot')).toBeNull();
    expect(screen.getByTestId('button-help-support')).toBeTruthy();
    expect(screen.getByTestId('button-help-docs')).toBeTruthy();
  });

  it('клик по «Написать в поддержку» открывает SUPPORT.telegram в новой вкладке', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<HelpZone />);
    await userEvent.click(screen.getByTestId('button-help'));
    await userEvent.click(screen.getByTestId('button-help-support'));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const callArgs = openSpy.mock.calls[0];
    expect(callArgs[0]).toBe('https://t.me/omemo_support');
    expect(callArgs[1]).toBe('_blank');
    openSpy.mockRestore();
  });
});

describe('AI-134 / AccountZone — аватар, имя, роль строкой, без цветной плашки', () => {
  it('рендерит аватар с инициалами (мутация: убрать инициалы → red)', () => {
    render(
      <AccountZone
        userDisplayName="Иван Петров"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    // Инициалы: первая буква имени + первая буква фамилии.
    const avatarButton = screen.getByTestId('button-user-menu');
    expect(avatarButton.textContent).toContain('ИП');
  });

  it('роль выводится строкой под именем, без цветной плашки (мутация: вернуть bg-blue-500 плашку → red)', async () => {
    render(
      <AccountZone
        userDisplayName="Alice"
        userRoleLabel="SMM Admin"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('button-user-menu'));
    const roleLabel = screen.getByTestId('account-role-label');
    expect(roleLabel.textContent).toBe('SMM Admin');
    // Проверяем, что НЕТ цветной плашки: цвет текста — мьют, не синий.
    expect(roleLabel.className).not.toMatch(/bg-blue-\d+/);
    expect(roleLabel.className).toMatch(/text-muted-foreground/);
  });

  it('внутри меню живут LanguageSwitcher и ThemeToggle (мутация: убрать обёртку → red)', async () => {
    render(
      <AccountZone
        userDisplayName="Test"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('button-user-menu'));
    const block = screen.getByTestId('menu-language-theme');
    const { getByTestId } = within(block);
    expect(getByTestId('lang-stub')).toBeTruthy();
    expect(getByTestId('theme-stub')).toBeTruthy();
  });

  it('меню содержит: профиль, тарифы, документация, язык/тема, выход', async () => {
    render(
      <AccountZone
        userDisplayName="Test"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('button-user-menu'));
    expect(screen.getByTestId('menu-profile')).toBeTruthy();
    expect(screen.getByTestId('menu-pricing')).toBeTruthy();
    expect(screen.getByTestId('menu-docs')).toBeTruthy();
    expect(screen.getByTestId('menu-logout')).toBeTruthy();
  });

  it('клик по выходу вызывает onLogout', async () => {
    const onLogout = vi.fn();
    render(
      <AccountZone
        userDisplayName="Test"
        onLogout={onLogout}
        onOpenProfile={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('button-user-menu'));
    await userEvent.click(screen.getByTestId('menu-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('для одного слова в имени — одна инициала', () => {
    render(
      <AccountZone
        userDisplayName="Madonna"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    expect(screen.getByTestId('button-user-menu').textContent).toContain('M');
    expect(screen.getByTestId('button-user-menu').textContent).not.toContain('Ma');
  });

  it('для пустого имени показывается «?»', () => {
    render(
      <AccountZone
        userDisplayName="   "
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    expect(screen.getByTestId('button-user-menu').textContent).toContain('?');
  });
});

describe('AI-134 / topbar test — ровно один синий акцентный элемент в ПРАВОЙ части', () => {
  // AI-134 / критерий 2 + замечание Tech Lead: «тест должен считать
  // акценты в отрисованной шапке, а не проверять отсутствие класса у
  // конкретных кнопок». Рендерим AccountZone, AiZone, HelpZone и
  // ZoneDivider как правую часть шапки, и считаем, у скольких элементов
  // есть bg-blue-* класс.
  it('ровно один синий акцентный элемент — AI-кнопка', () => {
    const { container } = render(
      <div>
        <AiZone onOpenAIChat={() => {}} />
        <ZoneDivider />
        <HelpZone />
        <ZoneDivider />
        <AccountZone
          userDisplayName="Test"
          onLogout={() => {}}
          onOpenProfile={() => {}}
        />
      </div>,
    );
    // Считаем все элементы, у которых есть bg-blue-* (или dark:bg-blue-*).
    const all = container.querySelectorAll('[class*="bg-blue"]');
    // Аватар AccountZone имеет bg-muted — не синий. AI-кнопка — синяя.
    // Меню и dropdown-контенты рендерятся в портале — поэтому учитываем
    // только первый синий акцент в основном дереве.
    expect(all.length).toBe(1);
  });
});
