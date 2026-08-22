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
 * Автономный режим перенесён в ЛЕВУЮ часть рядом с выбором кампании
 * и живёт в Topbar.tsx, потому что его состояние и мутации
 * принадлежат уровню страницы, а не изолированной зоне.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
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

/** Вертикальный разделитель между зонами. AI-134 / критерий 1. */
export function ZoneDivider() {
  return (
    <div
      className="h-6 w-px bg-border mx-1"
      aria-hidden="true"
      data-testid="topbar-zone-divider"
    />
  );
}

/**
 * AI-помощник — единственная синяя акцентная кнопка во всей шапке.
 * AI-134 / критерий 2.
 *
 * Текст подписи обязателен: значок Sparkles без текста недостаточен,
 * чтобы пользователь понял, что кнопка делает. Текст берётся из
 * локали через `topbar.aiAssistantFull` (поправка ревью 22.08).
 */
export function AiZone({ onOpenAIChat }: { onOpenAIChat: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      onClick={onOpenAIChat}
      className="h-9 px-3 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      data-testid="button-ai-assistant"
      aria-label={t('topbar.aiAssistantFull')}
      title={t('topbar.aiAssistantFull')}
    >
      <Sparkles className="h-4 w-4 mr-1.5" aria-hidden="true" />
      <span className="text-sm font-medium">{t('topbar.aiAssistantFull')}</span>
    </Button>
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
 *
 * Переходы на /pricing и /help делаются через `<Link>` из wouter —
 * это SPA-навигация без перезагрузки страницы (правка ревью 22.08).
 *
 * data-testid="button-user-menu" и "menu-logout" сохранены, чтобы
 * прежние тесты продолжали работать.
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
        {/* <Link href="/pricing"> оборачивает DropdownMenuItem и
            рендерит якорь. asChild заставляет Radix Slot клонировать
            <a> и навесить на него обработчики. С EVENT этому была
            записка в Topbar.tsx (комментарий про SM-20 / Radix Slot
            в оригинальном коде). */}
        <DropdownMenuItem asChild data-testid="menu-pricing">
          <Link href="/pricing">
            <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
            <span>{t('topbar.pricing')}</span>
          </Link>
        </DropdownMenuItem>
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
 *
 * Переходы сделаны через `<Link>` (SPA) и `window.open` (внешняя
 * ссылка). `window.location.href` не используем: перезагрузка
 * теряет состояние (поправка ревью 22.08).
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
        <DropdownMenuItem asChild data-testid="button-help-docs">
          <Link href="/help">
            <BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />
            <span>{t('topbar.documentation')}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
