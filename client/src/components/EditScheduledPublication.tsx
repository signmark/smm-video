import React from 'react';
import { CampaignContent, PlatformPublishInfo } from '@/types';
import { SafeSocialPlatform, platformNames, safeSocialPlatforms } from '@/lib/social-platforms';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { CalendarIcon, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getConnectedPlatformsMap } from '@/lib/platform-connection';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import PlatformSelector from './PlatformSelector';
import { getCanonicalScheduledAt, setLocalScheduleTime } from '@shared/schedule-time';

// Создаем схему валидации
const scheduledPublicationSchema = z.object({
  scheduledAt: z.date().nullable(),
  selectedPlatforms: z.record(z.boolean()),
  platformTimes: z.record(z.string(), z.object({
    hour: z.string(),
    minute: z.string()
  })).optional()
});

type EditPublicationFormValues = z.infer<typeof scheduledPublicationSchema>;

// Генерация часов для выбора
const hours = Array.from({ length: 24 }, (_, i) => 
  i.toString().padStart(2, '0')
);

// Генерация минут для выбора (шаг 5 минут)
const minutes = Array.from({ length: 12 }, (_, i) => 
  (i * 5).toString().padStart(2, '0')
);

interface EditScheduledPublicationProps {
  content: CampaignContent;
  onCancel: () => void;
  onSave: () => void;
}

export default function EditScheduledPublication({ 
  content,
  onCancel,
  onSave 
}: EditScheduledPublicationProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Раньше сюда передавался захардкоженный список «все подключены», и планировать
  // публикацию можно было в платформу, которой у кампании нет — падало уже при
  // публикации. Тянем настройки кампании и считаем статус тем же хелпером, что и
  // остальная морда. Пока настройки не загрузились — null, и PlatformSelector
  // никого не блокирует: соврать «не подключено» на время загрузки хуже.
  const campaignId = (content as any)?.campaignId || (content as any)?.campaign_id;
  const { data: campaignEnvelope } = useQuery({
    queryKey: ['campaign-social-settings', campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      });
      if (!response.ok) throw new Error('Не удалось загрузить настройки кампании');
      return response.json();
    },
  });
  const connectedPlatforms = getConnectedPlatformsMap(
    campaignEnvelope?.data?.social_media_settings ?? campaignEnvelope?.data?.socialMediaSettings,
  );

  // Устанавливаем начальное состояние для выбранных платформ
  const getInitialPlatforms = () => {
    const platforms: Record<string, boolean> = {};
    safeSocialPlatforms.forEach(p => { platforms[p] = false; });
    
    if (content.socialPlatforms) {
      Object.keys(content.socialPlatforms).forEach(key => {
        if (safeSocialPlatforms.includes(key as SafeSocialPlatform)) {
          const platform = key as SafeSocialPlatform;
          const platformData = content.socialPlatforms?.[platform];
          
          // Платформа выбрана если:
          // 1. Есть данные платформы
          // 2. Статус НЕ 'cancelled'
          // 3. ИЛИ статус 'scheduled' или 'pending' или 'published'
          if (platformData) {
            const status = platformData.status;
            const isSelected = status && status !== 'cancelled';
            platforms[platform] = !!isSelected;
          }
        }
      });
    }
    
    return platforms;
  };

  // Получаем время из даты в локальном часовом поясе пользователя
  const getTimeFromDate = (date: Date | null | undefined) => {
    if (!date) return { hour: '12', minute: '00' };
    return {
      hour: date.getHours().toString().padStart(2, '0'),
      minute: (Math.floor(date.getMinutes() / 5) * 5).toString().padStart(2, '0')
    };
  };

  // Устанавливаем начальное состояние для времени публикации для каждой платформы
  const getInitialPlatformTimes = () => {
    const scheduledDate = content.scheduledAt ? new Date(content.scheduledAt) : null;
    const defaultTime = getTimeFromDate(scheduledDate);
    
    const times: Record<string, { hour: string, minute: string }> = {};
    
    safeSocialPlatforms.forEach(platform => {
      if (content.socialPlatforms?.[platform]) {
        const platformDate = content.socialPlatforms[platform].scheduledAt 
          ? new Date(content.socialPlatforms[platform].scheduledAt as string)
          : scheduledDate;
          
        times[platform] = getTimeFromDate(platformDate);
      } else {
        times[platform] = { ...defaultTime };
      }
    });
    
    return times;
  };

  // Создаем форму с начальными значениями в локальном часовом поясе пользователя
  const form = useForm<EditPublicationFormValues>({
    resolver: zodResolver(scheduledPublicationSchema),
    defaultValues: {
      scheduledAt: content.scheduledAt ? new Date(content.scheduledAt) : null,
      selectedPlatforms: getInitialPlatforms(),
      platformTimes: getInitialPlatformTimes()
    }
  });

  // Обработчик сохранения формы
  const onSubmit = async (values: EditPublicationFormValues) => {
    try {
      const { scheduledAt, selectedPlatforms, platformTimes } = values;
      
      // Если дата не выбрана, нельзя запланировать публикацию
      if (!scheduledAt) {
        toast({
          title: "Ошибка",
          description: "Пожалуйста, выберите дату публикации",
          variant: "destructive",
        });
        return;
      }
      
      // Токен обновляется автоматически через queryClient при необходимости
      
      // НОВАЯ ЛОГИКА: Формируем socialPlatforms только с выбранными платформами
      const socialPlatforms: Record<string, any> = {};
      
      // Object.entries всегда отдаёт ключ как string, хотя здесь он заведомо
      // SocialPlatform — сужаем явно, иначе индексация Record<SocialPlatform,…>
      // ниже становится неявным any.
      (Object.entries(selectedPlatforms) as [SafeSocialPlatform, boolean][]).forEach(([platform, isSelected]) => {
        if (isSelected) {
          // Получаем существующие данные для платформы
          // `|| {}` давал пустой объектный литерал, у которого нет ни status,
          // ни publishedAt — отсюда «Property 'status' does not exist on type
          // '{}'». Тип задаём явно: отсутствующая платформа — это частично
          // заполненная запись, а не пустышка неизвестной формы.
          const existingData: Partial<PlatformPublishInfo> = content.socialPlatforms?.[platform] ?? {};
          
          // Создаем дату публикации для этой платформы
          const time = platformTimes?.[platform] || { hour: '12', minute: '00' };
          const platformDate = setLocalScheduleTime(scheduledAt, time);
          
          // Создаем строку даты, используя UTC-совместимый формат для сервера
          const localISOString = platformDate.toISOString();
          
          // ЗАЩИТА: Обновляем только время, но сохраняем статус published если он есть
          const preservedStatus = existingData.status === 'published' ? 'published' : 'scheduled';

          
          socialPlatforms[platform] = {
            ...existingData,
            // Не меняем статус published на scheduled!
            status: preservedStatus,
            scheduledAt: localISOString,
            scheduled_at: localISOString,
            // Сохраняем publishedAt если контент уже опубликован
            publishedAt: existingData.publishedAt || null
          };
        }
        // ЕСЛИ ПЛАТФОРМА НЕ ВЫБРАНА - ПРОСТО НЕ ДОБАВЛЯЕМ ЕЁ В JSON
      });
      
      // Проверяем, есть ли хотя бы одна активная платформа (не cancelled)
      const activePlatforms = Object.values(socialPlatforms).filter(
        (platform: any) => platform.status === 'scheduled' || platform.status === 'published'
      );
      
      if (activePlatforms.length === 0) {
        toast({
          title: "Предупреждение",
          description: "Не выбрана ни одна платформа для публикации",
          variant: "destructive",
        });
        return;
      }
      
      // Получаем токен авторизации из localStorage
      const authToken = localStorage.getItem('auth_token');
      
      // Формируем заголовки с авторизацией
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;

      } else {
        console.warn('Токен авторизации не найден в localStorage!');
        toast({
          title: "Ошибка авторизации",
          description: "Необходимо авторизоваться для планирования публикаций",
          variant: "destructive"
        });
        return;
      }
      
      // Отправляем данные на сервер через новый endpoint direct-schedule
      const canonicalScheduledAt = getCanonicalScheduledAt(socialPlatforms, scheduledAt);
      if (!canonicalScheduledAt) {
        throw new Error('Не удалось определить время публикации');
      }

      await apiRequest(`/api/direct-schedule/${content.id}`, {
        method: 'POST',
        headers,
        data: {
          scheduledAt: canonicalScheduledAt,
          socialPlatforms
        }
      });
      
      // Инвалидируем кэш для запланированных публикаций
      queryClient.invalidateQueries({ queryKey: ['/api/campaign-content'] });
      
      onSave();
    } catch (error) {
      console.error("Ошибка при сохранении настроек публикации:", error);
      
      toast({
        title: "Ошибка",
        description: "Не удалось обновить настройки публикации. Пожалуйста, попробуйте снова.",
        variant: "destructive",
      });
    }
  };

  // Обработчик изменения выбора платформы
  const handlePlatformChange = (platform: SafeSocialPlatform, isSelected: boolean) => {

    form.setValue(`selectedPlatforms.${platform}`, isSelected);

  };

  const selectedPlatforms = form.watch('selectedPlatforms');
  const activePlatforms = safeSocialPlatforms.filter(p => selectedPlatforms[p]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

        {/* Дата */}
        <FormField
          control={form.control}
          name="scheduledAt"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-sm">Дата публикации</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn("w-full pl-3 text-left font-normal h-9", !field.value && "text-muted-foreground")}
                    >
                      {field.value ? format(field.value, "dd MMMM yyyy", { locale: ru }) : <span>Выберите дату</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value || undefined}
                    onSelect={field.onChange}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Платформы */}
        <div className="space-y-2">
          <FormLabel className="text-sm">Социальные платформы</FormLabel>
          <PlatformSelector
            selectedPlatforms={selectedPlatforms}
            onChange={handlePlatformChange}
            content={{
              contentType: content.contentType,
              imageUrl: content.imageUrl ?? undefined,
              images: (content as any).images ?? undefined,
              videoUrl: content.videoUrl ?? (content as any).video_url ?? undefined,
              additionalImages: content.additionalImages ?? undefined,
              additionalVideos: content.additionalVideos ?? undefined
            }}
            connectedPlatforms={connectedPlatforms}
          />
        </div>

        {/* Время — компактная таблица */}
        {activePlatforms.length > 0 && (
          <div className="space-y-2">
            <FormLabel className="text-sm">Время публикации</FormLabel>
            <div className="grid grid-cols-2 gap-2">
              {activePlatforms.map(platform => (
                <div key={platform} className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-muted/30">
                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 shrink-0">{platformNames[platform]}</Badge>
                  <div className="flex items-center gap-1 ml-auto">
                    <FormField
                      control={form.control}
                      name={`platformTimes.${platform}.hour`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-[58px] h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {hours.map(h => <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <span className="text-xs text-muted-foreground">:</span>
                    <FormField
                      control={form.control}
                      name={`platformTimes.${platform}.minute`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-[58px] h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {minutes.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Отмена</Button>
          <Button type="submit" size="sm">Сохранить</Button>
        </div>
      </form>
    </Form>
  );
}
