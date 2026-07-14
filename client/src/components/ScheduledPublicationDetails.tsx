import React, { useState } from 'react';
import { CampaignContent, SocialPlatform } from '@/types';
import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, Eye, Edit2, Image as ImageIcon, Clock, AlertCircle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import EditScheduledPublication from './EditScheduledPublication';
import { safeSocialPlatforms, SafeSocialPlatform } from '@/lib/social-platforms';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ScheduledPublicationDetailsProps {
  content: CampaignContent;
  onCancelSuccess?: (updatedContent?: CampaignContent) => void;
  onViewDetails?: (content: CampaignContent) => void;
}

const PLATFORM_ABBR: Record<string, string> = {
  telegram: 'TG',
  vk: 'VK',
  instagram: 'IG',
  facebook: 'FB',
  youtube: 'YT',
  threads: 'Th',
};

const PLATFORM_FULL: Record<string, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  threads: 'Threads',
};

const PLATFORM_CHIP_CLASS: Record<string, string> = {
  telegram: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  vk: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  facebook: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  youtube: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  threads: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-amber-400',
  scheduled: 'bg-blue-400',
  published: 'bg-green-400',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
};

function formatDateBlock(date: string | Date | null | undefined) {
  if (!date) return null;
  try {
    const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let dateStr = typeof date === 'string' ? date : date.toISOString();
    if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')) {
      dateStr += 'Z';
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return {
      day: formatInTimeZone(d, userTZ, 'd', { locale: ru }),
      month: formatInTimeZone(d, userTZ, 'MMM', { locale: ru }).replace('.', ''),
      time: formatInTimeZone(d, userTZ, 'HH:mm', { locale: ru }),
      full: formatInTimeZone(d, userTZ, 'dd MMMM yyyy, HH:mm', { locale: ru }),
    };
  } catch {
    return null;
  }
}

function formatTime(date: string | Date | null | undefined): string | null {
  if (!date) return null;
  try {
    const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let dateStr = typeof date === 'string' ? date : date.toISOString();
    if (typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')) {
      dateStr += 'Z';
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return formatInTimeZone(d, userTZ, 'HH:mm', { locale: ru });
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function ScheduledPublicationDetails({ 
  content,
  onCancelSuccess,
  onViewDetails 
}: ScheduledPublicationDetailsProps) {
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isMovingToDraft, setIsMovingToDraft] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleCancelPublication = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      const authToken = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await apiRequest(`/api/publish/cancel/${content.id}`, { method: 'POST', headers });
      if (response && !response.error) {
        if (onCancelSuccess) onCancelSuccess();
      } else {
        throw new Error(response?.error || 'Не удалось отменить');
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || 'Неизвестная ошибка', variant: "destructive" });
      setIsCancelling(false);
    }
  };

  const handleMoveToDraft = async () => {
    if (isMovingToDraft) return;
    setIsMovingToDraft(true);
    try {
      const response = await apiRequest(`/api/publish/update-content/${content.id}`, {
        method: 'PATCH',
        data: { status: 'draft', scheduled_at: null, social_platforms: {} }
      });
      if (response && !response.error) {
        if (onCancelSuccess) onCancelSuccess();
      } else {
        throw new Error(response?.error || 'Не удалось переместить');
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || 'Неизвестная ошибка', variant: "destructive" });
      setIsMovingToDraft(false);
    }
  };

  const handleRetryFailed = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      const response = await apiRequest(`/api/retry-failed/${content.id}`, { method: 'POST' });
      if (response?.success) {
        const names = (response.retried || []).join(', ');
        toast({ title: "Повтор запущен", description: `Платформы поставлены в очередь: ${names}` });
        if (onCancelSuccess) onCancelSuccess();
      } else {
        throw new Error(response?.error || 'Не удалось запустить повтор');
      }
    } catch (error: any) {
      toast({ title: "Ошибка", description: error?.message || 'Неизвестная ошибка', variant: "destructive" });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSaveSuccess = () => {
    setIsEditDialogOpen(false);
    if (onCancelSuccess) onCancelSuccess();
    toast({ title: "Изменения сохранены", description: "Публикация обновлена." });
  };

  const platforms = safeSocialPlatforms.filter(p =>
    content.socialPlatforms &&
    content.socialPlatforms[p] &&
    content.socialPlatforms[p].status !== 'cancelled'
  );

  const getPlatformDate = (platform: SafeSocialPlatform) => {
    if (!content.socialPlatforms?.[platform]) return content.scheduledAt;
    return content.socialPlatforms[platform].scheduledAt || content.scheduledAt;
  };

  const getPlatformStatus = (platform: SafeSocialPlatform) => {
    return content.socialPlatforms?.[platform]?.status || 'scheduled';
  };

  const hasFailedPlatforms = platforms.some(p => getPlatformStatus(p) === 'failed');

  const dateBlock = formatDateBlock(content.scheduledAt);
  const contentPreview = content.content ? stripHtml(content.content).slice(0, 120) : '';
  const hasImage = content.imageUrl && typeof content.imageUrl === 'string' && content.imageUrl.startsWith('http');

  const allSameTime = platforms.every(p => {
    const t = formatTime(getPlatformDate(p));
    return t === dateBlock?.time;
  });

  return (
    <>
      <div className="flex items-stretch gap-0 border rounded-lg bg-card overflow-hidden hover:shadow-sm transition-shadow">
        
        {/* Левый блок — дата */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center px-3 py-3 bg-blue-50 dark:bg-blue-950/40 border-r border-blue-100 dark:border-blue-900 min-w-[64px] text-center">
          <span className="text-[11px] font-medium text-blue-500 dark:text-blue-400 uppercase tracking-wide leading-none">
            {dateBlock?.month ?? '—'}
          </span>
          <span className="text-2xl font-bold text-blue-700 dark:text-blue-300 leading-tight">
            {dateBlock?.day ?? '?'}
          </span>
          <span className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 leading-none mt-0.5">
            {dateBlock?.time ?? '—:—'}
          </span>
        </div>

        {/* Центральный блок — контент */}
        <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center gap-1.5">
          
          {/* Заголовок + индикаторы */}
          <div className="flex items-center gap-1.5 min-w-0">
            {hasFailedPlatforms && (
              <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
            )}
            <span className="font-semibold text-sm leading-tight truncate text-foreground">
              {content.title || contentPreview.slice(0, 60) || 'Без названия'}
            </span>
            {hasImage && (
              <ImageIcon size={12} className="text-muted-foreground flex-shrink-0" />
            )}
          </div>

          {/* Предпросмотр контента */}
          {contentPreview && (
            <p className="text-xs text-muted-foreground line-clamp-1 leading-snug">
              {contentPreview}
            </p>
          )}

          {/* Платформы */}
          {platforms.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <TooltipProvider delayDuration={200}>
                {platforms.map(platform => {
                  const status = getPlatformStatus(platform);
                  const time = formatTime(getPlatformDate(platform));
                  const showTime = !allSameTime && time;
                  const chipClass = PLATFORM_CHIP_CLASS[platform] || 'bg-gray-100 text-gray-700';
                  const dotClass = STATUS_DOT[status] || 'bg-gray-400';

                  return (
                    <Tooltip key={platform}>
                      <TooltipTrigger asChild>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium leading-none cursor-default ${chipClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
                          {PLATFORM_ABBR[platform] || platform}
                          {showTime && <span className="opacity-70">{time}</span>}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <p>{PLATFORM_FULL[platform]}</p>
                        {time && <p className="text-muted-foreground">{time}</p>}
                        <p className="capitalize">{status === 'pending' ? 'Ожидает' : status === 'scheduled' ? 'Запланировано' : status === 'published' ? 'Опубликовано' : status === 'failed' ? 'Ошибка' : status}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </TooltipProvider>
              {allSameTime && dateBlock?.time && (
                <span className="text-[11px] text-muted-foreground ml-0.5">· все в {dateBlock.time}</span>
              )}
            </div>
          )}
        </div>

        {/* Правый блок — кнопки */}
        <div className="flex-shrink-0 flex items-center gap-0.5 px-2 border-l border-border">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onViewDetails?.(content)}
                  data-testid={`btn-view-${content.id}`}
                >
                  <Eye size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Детали</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsEditDialogOpen(true)}
                  data-testid={`btn-edit-${content.id}`}
                >
                  <Edit2 size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Изменить</TooltipContent>
            </Tooltip>

            {hasFailedPlatforms && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                    onClick={handleRetryFailed}
                    disabled={isRetrying}
                    data-testid={`btn-retry-${content.id}`}
                  >
                    <RotateCcw size={15} className={isRetrying ? 'animate-spin' : ''} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Повторить для платформ с ошибкой</TooltipContent>
              </Tooltip>
            )}

            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      data-testid={`btn-cancel-${content.id}`}
                    >
                      <Ban size={15} />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Отменить публикацию</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Отменить публикацию?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Запланированная публикация будет отменена. Это действие нельзя отменить.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Нет</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancelPublication} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Отменить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TooltipProvider>
        </div>
      </div>

      {/* Диалог редактирования */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Редактирование запланированной публикации</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 pr-1">
            <EditScheduledPublication 
              content={content}
              onCancel={() => setIsEditDialogOpen(false)}
              onSave={handleSaveSuccess}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
