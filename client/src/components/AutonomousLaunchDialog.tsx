import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bot, Zap, GitMerge, SlidersHorizontal } from "lucide-react";

export type PipelineMode = 'full_auto' | 'controlled' | 'mixed';

interface AutonomousLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId?: string | null;
  userId?: string | null;
  token?: string | null;
  /** Сохранённые настройки автономного режима кампании (interval/posts/…). Опционально. */
  autonomousSettings?: {
    intervalHours?: number;
    postsPerCycle?: number;
    autoSchedule?: boolean;
    withImages?: boolean;
  } | null;
  /** Вызывается после успешного запуска (напр. инвалидировать статус). */
  onStarted?: () => void;
}

const MODES: Array<{
  id: PipelineMode;
  icon: JSX.Element;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
}> = [
  {
    id: 'full_auto',
    icon: <Zap className="h-5 w-5 text-green-500" />,
    title: 'Полный автомат',
    description: 'Генерирует план, пишет тексты, создаёт картинки и публикует по расписанию — без остановок.',
    badge: 'Рекомендуется',
    badgeColor: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  {
    id: 'mixed',
    icon: <GitMerge className="h-5 w-5 text-blue-500" />,
    title: 'Смешанный',
    description: 'Показывает контент-план на одобрение, затем самостоятельно пишет, генерирует картинки и публикует.',
    badge: 'С одобрением плана',
    badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  {
    id: 'controlled',
    icon: <SlidersHorizontal className="h-5 w-5 text-orange-500" />,
    title: 'С контролем',
    description: 'После каждого шага (план → тексты → картинки) показывает результат и ждёт вашего одобрения.',
    badge: 'Максимальный контроль',
    badgeColor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  },
];

/**
 * Диалог выбора режима автономного ассистента (3 режима автономности).
 * Один и тот же вход и из топбара (робот), и из генератора КП («Доверить агенту»).
 */
export function AutonomousLaunchDialog({
  open,
  onOpenChange,
  campaignId,
  userId,
  token,
  autonomousSettings,
  onStarted,
}: AutonomousLaunchDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedMode, setSelectedMode] = useState<PipelineMode>('full_auto');

  const { mutate: startAutonomousWithMode, isPending } = useMutation({
    mutationFn: async (mode: PipelineMode) => {
      const authToken = token || localStorage.getItem('auth_token') || '';
      const res = await fetch('/api/autonomous/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken ? `Bearer ${authToken}` : '' },
        body: JSON.stringify({
          campaignId,
          userId,
          interval: autonomousSettings?.intervalHours ?? 8,
          postsPerCycle: autonomousSettings?.postsPerCycle ?? 1,
          autoSchedule: autonomousSettings?.autoSchedule ?? true,
          withImages: autonomousSettings?.withImages ?? true,
          pipelineMode: mode,
          auth_token: localStorage.getItem('auth_token'),
          refresh_token: localStorage.getItem('refresh_token'),
        }),
      });
      // Сервер отвечает {error} с 4xx/5xx — без throw мутация «успешна» и
      // пользователь видел тост «Агент запущен» при упавшем старте.
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/autonomous/status', campaignId] });
      onStarted?.();
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        variant: 'destructive',
        title: 'Не удалось запустить агента',
        description: e?.message || 'Неизвестная ошибка',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="dialog-pipeline-mode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Запуск автономного ассистента
          </DialogTitle>
          <DialogDescription>
            Выберите режим работы — насколько автономно должен действовать ассистент
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {MODES.map((option) => (
            <button
              key={option.id}
              data-testid={`option-mode-${option.id}`}
              onClick={() => setSelectedMode(option.id)}
              className={`w-full text-left rounded-lg border-2 p-4 transition-all ${
                selectedMode === option.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{option.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{option.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${option.badgeColor}`}>
                      {option.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                </div>
                <div className={`h-4 w-4 rounded-full border-2 mt-0.5 flex-shrink-0 ${
                  selectedMode === option.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                }`} />
              </div>
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-mode-cancel">
            Отмена
          </Button>
          <Button
            onClick={() => startAutonomousWithMode(selectedMode)}
            disabled={isPending || !campaignId}
            data-testid="button-mode-confirm"
            className="gap-2"
          >
            <Bot className="h-4 w-4" />
            {isPending ? 'Запускаем…' : 'Запустить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
