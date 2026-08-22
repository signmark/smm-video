/**
 * AI-134 / #86 — topbar zones unit tests.
 *
 * Каждый тест — поведенческий, мутационно-устойчивый: если из TopbarZones
 * пропадёт ключевая обёртка (ZoneDivider, переключение иконки, рендер имени,
 * расположение языка/темы внутри AccountZone) — соответствующий тест
 * покраснеет.
 *
 * Правки 22.08 (после ревью Tech Lead):
 *  — мок i18n возвращает РЕАЛЬНЫЕ строки (те же, что в ru.json), а не
 *    ключ локали. Иначе нельзя проверить, что текст действительно
 *    переведён, а не просто остался английским ключом;
 *  — меню учётки больше НЕ содержит пункта «Документация» (он перенесён
 *    в HelpZone, чтобы не дублировать);
 *  — пункт «Тарифы» рендерится как <Link href="/pricing"> (SPA), не
 *    window.location.href.
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

// i18n в jsdom может падать на отсутствующих ресурсах — мокаем с теми
// же строками, что в ru.json. Так тесты проверяют реальный перевод, а
// не «ключ как строку».
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'topbar.aiAssistantFull': 'ИИ-помощник',
        'topbar.help': 'Помощь',
        'topbar.writeSupport': 'Написать в поддержку',
        'topbar.documentation': 'Документация',
        'topbar.languageAndTheme': 'Язык и тема',
        'topbar.tgAssistant': 'TG Ассистент',
        'topbar.pricing': 'Тарифы',
        'settings.profile': 'Профиль',
        'auth.logout': 'Выход',
      };
      return dict[key] ?? key;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}));

// wouter: TopbarZones использует useLocation() + navigate() для
// программной SPA-навигации внутри dropdown (правка 22.08 — связка
// asChild+Link теряла onSelect и меню не закрывалось). Мок заменяем
// на объект с vi.fn(), чтобы тесты могли проверять, что onSelect
// вызывает navigate с правильным href. Сам факт SPA-навигации
// (URL меняется, страница не перезагружается, dropdown закрывается)
// проверяет браузерная проверка Playwright.
const wouterNavigateMock = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/', wouterNavigateMock],
  Link: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
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

  it('скрыт на узком экране (< sm), виден на десктопе (правка 22.08)', () => {
    const { container } = render(<ZoneDivider />);
    const div = container.querySelector('[data-testid="topbar-zone-divider"]')!;
    expect(div.className).toMatch(/hidden/);
    expect(div.className).toMatch(/sm:block/);
  });
});

describe('AI-134 / AiZone — единственный синий акцент', () => {
  it('рендерит кнопку с синим фоном; подпись приходит из локали', () => {
    const onOpen = vi.fn();
    render(<AiZone onOpenAIChat={onOpen} />);
    const btn = screen.getByTestId('button-ai-assistant');
    expect(btn).toBeTruthy();
    // Подпись есть в DOM (даже если скрыта через hidden sm:inline) —
    // браузерная проверка скрытия лежит на Playwright-evidence.
    expect(btn.textContent).toContain('ИИ-помощник');
    expect(btn.className).toMatch(/bg-blue-600|bg-blue-500/);
  });

  it('подпись имеет класс hidden sm:inline — на узком экране скрыта (правка 22.08)', () => {
    render(<AiZone onOpenAIChat={() => {}} />);
    const btn = screen.getByTestId('button-ai-assistant');
    const labelSpan = btn.querySelector('span');
    expect(labelSpan).toBeTruthy();
    expect(labelSpan!.className).toMatch(/hidden/);
    expect(labelSpan!.className).toMatch(/sm:inline/);
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
    await userEvent.click(screen.getByTestId('button-help'));
    const items = [
      screen.getByTestId('button-help-support'),
      screen.getByTestId('button-tg-bot'),
      screen.getByTestId('button-help-docs'),
    ];
    expect(items).toHaveLength(3);
  });

  it('текст пунктов меню приходит из локали (поправка 22.08)', async () => {
    render(<HelpZone />);
    await userEvent.click(screen.getByTestId('button-help'));
    expect(screen.getByTestId('button-help-support').textContent).toContain('Написать в поддержку');
    expect(screen.getByTestId('button-help-docs').textContent).toContain('Документация');
  });

  it('документация ведёт на /help через navigate() (поправка 22.08)', async () => {
    wouterNavigateMock.mockClear();
    render(<HelpZone />);
    await userEvent.click(screen.getByTestId('button-help'));
    await userEvent.click(screen.getByTestId('button-help-docs'));
    expect(wouterNavigateMock).toHaveBeenCalledWith('/help');
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
    // Подпись тоже через локаль (поправка 22.08).
    expect(block.textContent).toContain('Язык и тема');
  });

  it('меню содержит: профиль, тарифы (через Link), язык/тема, выход. Документации нет — она в HelpZone', async () => {
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
    expect(screen.queryByTestId('menu-docs')).toBeNull();
    expect(screen.getByTestId('menu-logout')).toBeTruthy();
  });

  it('«Тарифы» — это DropdownMenuItem onSelect → navigate(\'/pricing\') (поправка 22.08)', async () => {
    wouterNavigateMock.mockClear();
    render(
      <AccountZone
        userDisplayName="Test"
        onLogout={() => {}}
        onOpenProfile={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('button-user-menu'));
    await userEvent.click(screen.getByTestId('menu-pricing'));
    expect(wouterNavigateMock).toHaveBeenCalledWith('/pricing');
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
    const all = container.querySelectorAll('[class*="bg-blue"]');
    expect(all.length).toBe(1);
  });
});
