import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import RichTextEditor from '@/components/RichTextEditor';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, Save, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Проверяем, открыто ли в Telegram WebApp
const isTelegramWebApp = typeof window !== 'undefined' && 
  window.Telegram?.WebApp?.initData;

// Типы для контента (API возвращает { data: {...} })
interface ApiResponse {
  data: {
    content?: string;
    title?: string;
    campaignId?: string;
    [key: string]: any;
  };
}

export default function EditContentPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  // Загружаем контент
  const { data: response, isLoading } = useQuery<ApiResponse>({
    queryKey: [`/api/campaign-content/${contentId}`],
    enabled: !!contentId,
  });

  // Заполняем редактор при загрузке
  useEffect(() => {
    if (response?.data) {
      if (response.data.content) {
        setContent(response.data.content);
      }
      if (response.data.title) {
        setTitle(response.data.title);
      }
    }
  }, [response]);

  // Мутация для сохранения
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Объединяем существующие данные с изменёнными
      const updatedData = {
        ...(response?.data || {}),
        content,
        title,
      };
      
      return apiRequest(`/api/campaign-content/${contentId}`, {
        method: 'PATCH',
        data: updatedData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaign-content/${contentId}`] });
      setIsSaved(true);
      toast({
        title: '✅ Сохранено',
        description: 'Контент успешно обновлён',
      });
      
      // Если открыто в Telegram WebApp, закрываем после сохранения
      if (window.Telegram && window.Telegram.WebApp) {
        setTimeout(() => {
          window.Telegram!.WebApp.close();
        }, 1500);
      }
    },
    onError: (error: any) => {
      toast({
        title: '❌ Ошибка',
        description: error.message || 'Не удалось сохранить контент',
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  const handleCancel = () => {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.close();
    } else {
      window.history.back();
    }
  };

  // Настройка Telegram WebApp при монтировании
  useEffect(() => {
    if (isTelegramWebApp && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      
      // Разворачиваем на весь экран
      tg.expand();
      
      // Включаем кнопку "Назад"
      tg.BackButton.show();
      tg.BackButton.onClick(handleCancel);
      
      // Настраиваем главную кнопку для сохранения
      tg.MainButton.show();
      tg.MainButton.onClick(handleSave);
      
      return () => {
        tg.BackButton.hide();
        tg.MainButton.hide();
      };
    }
  }, [content, title]);

  // Обновляем состояние главной кнопки при изменениях
  useEffect(() => {
    if (isTelegramWebApp && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      
      if (saveMutation.isPending) {
        tg.MainButton.disable();
      } else if (isSaved) {
        tg.MainButton.enable();
      } else {
        tg.MainButton.enable();
      }
    }
  }, [saveMutation.isPending, isSaved]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Загрузка контента...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 pb-24">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Редактор контента</span>
              {isSaved && <Check className="h-5 w-5 text-green-500" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Заголовок */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Заголовок
              </label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsSaved(false);
                }}
                placeholder="Введите заголовок поста..."
                className="text-lg"
                data-testid="input-title"
              />
            </div>

            {/* Редактор контента */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Контент
              </label>
              <RichTextEditor
                value={content}
                onChange={(newContent) => {
                  setContent(newContent);
                  setIsSaved(false);
                }}
                placeholder="Начните вводить текст поста..."
                minHeight={400}
                enableResize={true}
              />
            </div>

            {/* Кнопки сохранения (только для веб-версии) */}
            {!isTelegramWebApp && (
              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saveMutation.isPending}
                  data-testid="button-cancel"
                >
                  <X className="h-4 w-4 mr-2" />
                  Отмена
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Сохранение...
                    </>
                  ) : isSaved ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Сохранено
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Сохранить
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
