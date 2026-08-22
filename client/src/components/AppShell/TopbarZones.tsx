/**
 * AI-134 / #86 — три правых зоны шапки.
 *
 * ЗАЧЕМ. До #86 в правой части шапки стояли девять разных по смыслу
 * элементов подряд. Групп не было; автономный режим кампании стоял
 * в общей правой куче; вес не соответствовал важности.
 *
 * После #86 справа три зоны через тонкий вертикальный разделитель:
 *   1. AI-помощник — единственная заметная кнопка с текстом.
 *   2. «Помощь» — один значок с dropdown.
 *   3. Учётная запись — аватар с dropdown.
 *
 * Акцентный синий цвет — только у AI-кнопки (критерий приёмки #2).
 *
 * ВАЖНО про SPA-переходы внутри dropdown. Radix DropdownMenuItem +
 * wouter-Link через asChild НЕ работают вместе: wouter-Link при
 * asChild делает cloneElement с ОДНИМ onClick (навигационным),
 * затирая onClick от Radix Slot (тот, что закрывает меню). Результат:
 * URL меняется, но dropdown остаётся открытым (правка ревью 22.08).
 *
 * Контролируемое решение через `open` state + `onOpenChange` ПРОБОВАЛ —
 * оно ломается иначе: focus management Radix иногда переоткрывал меню
 * сразу после navigate. Поэтому DropdownMenu здесь uncontrolled,
 * а навигация — в onSelect (Radix сам закрывает).
 *
 * Если позже понадобится якорь для среднего/Ctrl+клика — НЕЛЬЗЯ
 * вернуть `<DropdownMenuItem asChild><Link>`: Link всё так же затирает
 * onClick Slot. Работает `<DropdownMenuItem asChild>` поверх обычного
 * `<a href>` со своим onClick (Radix Slot мерджит обработчики, ломается
 * именно wouter-Link).
 */
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import {
  Sparkles, LifeBuoy, CreditCard, User, LogOut,
  Send, BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SUPPORT } from '@/lib/support';

/** Вертикальный разделитель между зонами. AI-134 / критерий 1.
 *
 * На узком экране (< sm) разделитель не виден: он отнимает ~18 пикселей,
 * и без него правая группа помещается в 375 (см. браузерная проверка
 * 22.08). На десктопе возвращается — критерий приёмки #1.
 */
export function ZoneDivider() {
  return (
    <div
      className="hidden sm:block h-6 w-px bg-border mx-1"
      aria-hidden="true"
      data-testid="topbar-zone-divider"
    />
  );
}

/** AI-помощник — единственная синяя акцентная кнопка во всей шапке.
 * AI-134 / критерий 2. */
export function AiZone({ onOpenAIChat }: { onOpenAIChat: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      onClick={onOpenAIChat}
      className="h-9 px-2 sm:px-3 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      data-testid="button-ai-assistant"
      aria-label={t('topbar.aiAssistantFull')}
      title={t('topbar.aiAssistantFull')}
    >
      <Sparkles className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
      <span className="hidden sm:inline text-sm font-medium">
        {t('topbar.aiAssistantFull')}
      </span>
    </Button>
  );
}

/**
 * Пункт меню, который делает SPA-переход без полного reload и
 * закрывает dropdown.
 *
 * ЗАЧЕМ. Ради этого один тип — потому что связка asChild + Link
 * теряет закрытие (см. шапку файла).
 *
 * ОГРАНИЧЕНИЯ. Рендерит <div role="menuitem"> внутри DropdownMenuItem,
 * что соответствует стандарту ARIA. Семантически НЕ <a>, но
 * функционально — навигация и закрытие работают (session marker
 * переживает, dropdown закрывается).
 */
function NavMenuItem({
  href,
  icon: IconComp,
  testId,
  children,
}: {
  href: string;
  // Принимаем любой lucide-icon, у которого есть className.
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  children: React.ReactNode;
}) {
  const [, navigate] = useLocation();
  // Uncontrolled: Radix сам закрывает dropdown после onSelect.
  // Минус controlled (open={open} + setOpen(false)): focus management
  // иногда переоткрывал меню сразу после navigate (правка 22.08,
  // см. /tmp/ai134-spa-check.mjs — dropdown оставался открытым на
  // /pricing после клика). Uncontrolled надёжнее.
  return (
    <DropdownMenuItem
      onSelect={() => {
        navigate(href);
      }}
      data-testid={testId}
    >
      <IconComp className="mr-2 h-4 w-4" aria-hidden={true} />
      <span>{children}</span>
    </DropdownMenuItem>
  );
}

/**
 * Учётная запись — аватар с dropdown.
 *
 * AI-134 / критерий 4-5:
 *   — имя выводится крупно;
 *   — роль СТРОКОЙ под именем (а не цветной плашкой как раньше);
 *   — тарифы, язык, тема, выход — внутри, каждый достижим за один клик.
 *
 * Пункт «Документация» намеренно ОТСУТСТВУЕТ: он уже есть в
 * меню «Помощь» (см. HelpZone), дублировать — это ровно тот
 * беспорядок, который задача убирает (правка ревью 22.08).
 */
export function AccountZone({
  userDisplayName,
  userRoleLabel,
  onLogout,
  onOpenProfile,
}: {
  userDisplayName: string;
  userRoleLabel?: string;
  onLogout: () => void;
  onOpenProfile: () => void;
}) {
  const { t } = useTranslation();
  const initials = (() => {
    const trimmed = userDisplayName.trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-9 p-0 rounded-full"
          data-testid="button-user-menu"
          aria-label={userDisplayName}
          title={userDisplayName}
        >
          <span
            className="h-8 w-8 rounded-full bg-muted text-foreground inline-flex items-center justify-center text-sm font-semibold"
            aria-hidden="true"
          >
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-3 py-2">
          <DropdownMenuLabel className="px-0 py-0 text-sm font-medium">
            {userDisplayName}
          </DropdownMenuLabel>
          {userRoleLabel && (
            <p
              className="text-xs text-muted-foreground mt-0.5"
              data-testid="account-role-label"
            >
              {userRoleLabel}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenProfile} data-testid="menu-profile">
          <User className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{t('settings.profile')}</span>
        </DropdownMenuItem>
        <NavMenuItem href="/pricing" icon={CreditCard} testId="menu-pricing">
          {t('topbar.pricing')}
        </NavMenuItem>
        <DropdownMenuSeparator />
        {/* Язык и тема внутри меню учётной записи (AI-134).
            Подпись «Язык и тема» — через t() (поправка ревью 22.08). */}
        <div
          className="px-2 py-1.5 flex items-center justify-between gap-2"
          data-testid="menu-language-theme"
        >
          <span className="text-xs text-muted-foreground">
            {t('topbar.languageAndTheme')}
          </span>
          <span className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          className="text-red-600 dark:text-red-400"
          data-testid="menu-logout"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{t('auth.logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Помощь — один значок с dropdown.
 *
 * AI-134 / критерий 4: Телеграм-ассистент доступен, но не занимает
 * отдельного места в верхнем ряду.
 *
 * «Документация» ведёт на /help (поправка ревью 22.08: /docs не
 * существует, /help есть и работает). Пункт живёт ТОЛЬКО здесь —
 * в AccountZone его дублировать не нужно.
 */
export function HelpZone({ onOpenTGBot }: { onOpenTGBot?: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          data-testid="button-help"
          aria-label={t('topbar.help')}
          title={t('topbar.help')}
        >
          <LifeBuoy className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onClick={() => {
            window.open(SUPPORT.telegram, '_blank', 'noopener,noreferrer');
          }}
          data-testid="button-help-support"
        >
          <LifeBuoy className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{t('topbar.writeSupport')}</span>
        </DropdownMenuItem>
        {onOpenTGBot && (
          <DropdownMenuItem
            onClick={onOpenTGBot}
            data-testid="button-tg-bot"
          >
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            <span>{t('topbar.tgAssistant')}</span>
          </DropdownMenuItem>
        )}
        <NavMenuItem href="/help" icon={BookOpen} testId="button-help-docs">
          {t('topbar.documentation')}
        </NavMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
