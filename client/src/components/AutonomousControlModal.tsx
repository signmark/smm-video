/**
 * SM-20: модалка управления запущенным автономным режимом.
 *
 * Открывается при клике на активную иконку Bot в Topbar. Раньше этот же
 * клик вызывал /api/autonomous/stop — то есть «открыть настройки» и
 * «выключить режим» были одним действием. Тестировщик жаловался, что
 * случайно отключал режим, нажимая на иконку.
 *
 * Acceptance (terminal #3):
 * 1. Клик на активной иконке открывает заполненную модалку, режим
 *    остаётся включённым.
 * 2. Модалка показывает Pause/Resume (не деструктивные) и Disable
 *    (деструктивный). Закрытие через X / backdrop / Esc НЕ меняет
 *    состояние.
 * 3. Сохранение interval/posts-per-cycle оставляет режим включённым,
 *    текущий цикл дорабатывает со старым config, новый применяется с
 *    ближайшего цикла. Показываем короткий toast.
 * 4. Пауза/возобновление переживают рестарт (уже было реализовано
 *    для pause/resume) — здесь просто пробрасываем.
 */
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Pause, Play, Power, Loader2 } from 'lucide-react';

export interface AutonomousControlModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  token: string | null;
  /** Текущий статус и текущие настройки автономного режима. */
  status: {
    isActive: boolean;
    paused: boolean;
    interval: number;
    postsPerCycle: number;
    autoSchedule: boolean;
    withImages: boolean;
    cyclesCompleted: number;
    postsCreated: number;
  } | null;
  /** Коллбэки, чтобы Topbar мог реагировать на финальные действия. */
  onPause?: () => void;
  onResume?: () => void;
  onDisable?: () => void;
  onSaved?: () => void;
}

/**
 * Защита от случайного «Disable» (SM-20: деструктивная операция).
 * Хранит локально флаг «подтвердил ли пользователь», пока модалка
 * не закрыта. Закрытие модалки сбрасывает флаг.
 */
export function AutonomousControlModal({
  open,
  onOpenChange,
  campaignId,
  token,
  status,
  onPause,
  onResume,
  onDisable,
  onSaved,
}: AutonomousControlModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Рабочие копии настроек — отдельный state, чтобы изменения в форме
  // не дёргали сервер до Save.
  const [intervalHours, setIntervalHours] = useState<number>(status?.interval ?? 24);
  const [postsPerCycle, setPostsPerCycle] = useState<number>(status?.postsPerCycle ?? 1);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // Сбрасываем confirmDisable при каждом открытии, чтобы кнопка не
  // оставалась «подтверждённой» с прошлого сеанса.
  useEffect(() => {
    if (open) {
      setConfirmDisable(false);
      setIntervalHours(status?.interval ?? 24);
      setPostsPerCycle(status?.postsPerCycle ?? 1);
    }
  }, [open, status?.interval, status?.postsPerCycle]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/autonomous/update-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          campaignId,
          interval: Number(intervalHours),
          postsPerCycle: Number(postsPerCycle),
          autoSchedule: status?.autoSchedule,
          withImages: status?.withImages,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Не удалось сохранить настройки');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('autonomous.control.savedToast') || 'Настройки сохранены',
        description: t('autonomous.control.savedToastDescription') ||
          'Применятся с ближайшего цикла.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', campaignId] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: 'Ошибка',
        description: err?.message || 'Не удалось сохранить настройки',
        variant: 'destructive',
      });
    },
  });

  const isPaused = status?.paused ?? false;
  const hasChanges =
    Number(intervalHours) !== (status?.interval ?? 24) ||
    Number(postsPerCycle) !== (status?.postsPerCycle ?? 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="dialog-autonomous-control"
        onInteractOutside={(e) => {
          // Backdrop / outside click не должен ничего менять — SM-20 #2.
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle data-testid="autonomous-control-title">
            {t('autonomous.control.title') || 'Автономный режим'}
          </DialogTitle>
          <DialogDescription>
            {isPaused
              ? (t('autonomous.control.descriptionPaused') ||
                  'Сейчас на паузе. Настройки ниже применятся с ближайшего цикла.')
              : (t('autonomous.control.descriptionRunning') ||
                  'Активен. Текущий цикл доработает со старыми настройками, новые применятся с ближайшего.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Status banner */}
          <div
            data-testid="autonomous-control-status"
            className={`flex items-center gap-2 rounded-md p-2 text-sm ${
              isPaused
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`} />
            <span className="font-medium">
              {isPaused ? 'На паузе' : 'Активен'}
            </span>
            {status && (
              <span className="text-xs text-muted-foreground">
                · циклов: {status.cyclesCompleted ?? 0}, постов: {status.postsCreated ?? 0}
              </span>
            )}
          </div>

          {/* Pause/Resume */}
          <div className="flex items-center justify-between border rounded-md p-3">
            <div>
              <div className="text-sm font-medium">
                {isPaused ? 'Снять с паузы' : 'Поставить на паузу'}
              </div>
              <div className="text-xs text-muted-foreground">
                {isPaused
                  ? 'Расписание возобновится с того места, где было.'
                  : 'Таймеры снимаются, прогресс сохраняется.'}
              </div>
            </div>
            <Button
              size="sm"
              variant={isPaused ? 'default' : 'outline'}
              data-testid={isPaused ? 'button-autonomous-resume' : 'button-autonomous-pause'}
              onClick={() => {
                if (isPaused) onResume?.();
                else onPause?.();
                onOpenChange(false);
              }}
            >
              {isPaused ? (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  Возобновить
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 mr-1" />
                  На паузу
                </>
              )}
            </Button>
          </div>

          {/* Settings */}
          <div className="space-y-3 border rounded-md p-3">
            <div className="text-sm font-medium">Настройки цикла</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="interval-hours">
                  Интервал (часов)
                </label>
                <Input
                  id="interval-hours"
                  type="number"
                  min={1}
                  step={1}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Number(e.target.value) || 1)}
                  data-testid="input-autonomous-interval"
                  className="mt-1"
                  disabled={saveSettings.isPending}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="posts-per-cycle">
                  Постов за цикл
                </label>
                <Input
                  id="posts-per-cycle"
                  type="number"
                  min={1}
                  step={1}
                  value={postsPerCycle}
                  onChange={(e) => setPostsPerCycle(Number(e.target.value) || 1)}
                  data-testid="input-autonomous-posts"
                  className="mt-1"
                  disabled={saveSettings.isPending}
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => saveSettings.mutate()}
              disabled={!hasChanges || saveSettings.isPending}
              data-testid="button-autonomous-save"
            >
              {saveSettings.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Сохранить настройки
            </Button>
          </div>

          {/* Disable — деструктивное действие, требует подтверждения. */}
          <div className="border border-destructive/30 rounded-md p-3 bg-destructive/5">
            <div className="text-sm font-medium text-destructive">Выключить автономный режим</div>
            <div className="text-xs text-muted-foreground mt-1">
              Полностью останавливает режим. Счётчики циклов и постов обнуляются.
              Настройки ниже сохранятся в кампании, но режим придётся запустить заново.
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="confirm-disable"
                checked={confirmDisable}
                onChange={(e) => setConfirmDisable(e.target.checked)}
                data-testid="checkbox-confirm-disable"
              />
              <label htmlFor="confirm-disable" className="text-xs">
                Понимаю, что цикл и пост-каунтер сбросятся
              </label>
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={!confirmDisable}
              onClick={() => {
                onDisable?.();
                onOpenChange(false);
              }}
              data-testid="button-autonomous-disable"
              className="mt-2"
            >
              <Power className="h-4 w-4 mr-1" />
              Выключить
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-autonomous-close"
          >
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}