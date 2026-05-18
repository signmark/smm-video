import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CampaignContent, Campaign, SocialPlatform } from '@/types';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useCampaignStore } from '@/lib/campaignStore';
import { useAuthStore } from '@/lib/store';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Send, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function TestPublish() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [isImage, setIsImage] = useState<boolean>(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({
    telegram: true,
    vk: true,
    instagram: false,
    facebook: false
  });
  
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<Record<string, any> | null>(null);
  const [isResultOpen, setIsResultOpen] = useState<boolean>(false);
  
  // Используем глобальное состояние
  const { selectedCampaign } = useCampaignStore();
  const userId = useAuthStore((state) => state.userId);
  const getAuthToken = useAuthStore((state) => state.getAuthToken);
  
  // Получение списка кампаний для выбора
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['/api/campaigns'],
    enabled: !!userId,
  });
  
  // Создание временного контента для публикации
  const createTestContent = async () => {
    if (!title || !content || !selectedCampaign) {
      toast({
        title: "Ошибка",
        description: "Заполните обязательные поля: заголовок, содержание и выберите кампанию",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // Создаем данные для публикации
      const contentData = {
        title,
        content,
        userId,
        campaignId: selectedCampaign.id,
        contentType: isImage ? 'text-image' : 'text',
        status: 'draft',
        imageUrl: isImage ? imageUrl : undefined,
        hashtags: ['test', 'demo']
      };
      
      // Создаем временный контент
      const result = await apiRequest('/api/campaign-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        data: contentData
      });
      
      if (result.id) {
        toast({
          title: "Контент создан",
          description: "Контент успешно создан и готов к публикации"
        });
        
        // Публикуем созданный контент
        await publishContent(result.id);
      }
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: `Не удалось создать контент: ${error.message}`,
        variant: "destructive"
      });
    }
  };
  
  // Публикация контента
  const publishContent = async (contentId: string) => {
    try {
      setIsPublishing(true);
      
      // Получаем выбранные платформы
      const platforms = Object.keys(selectedPlatforms).filter(
        platform => selectedPlatforms[platform as SocialPlatform]
      ) as SocialPlatform[];
      
      if (platforms.length === 0) {
        toast({
          title: "Ошибка",
          description: "Выберите хотя бы одну платформу для публикации",
          variant: "destructive"
        });
        setIsPublishing(false);
        return;
      }
      
      // Публикуем контент
      const result = await apiRequest(`/api/publish/${contentId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        data: { platforms }
      });
      
      setPublishResult(result);
      setIsResultOpen(true);
      
      // Обновляем данные в кэше
      queryClient.invalidateQueries({ queryKey: ['/api/campaign-content'] });
      
      // Показываем toast что контент отправлен на публикацию (fire-and-forget)
      toast({
        title: "Контент отправлен на публикацию",
        description: "Контент отправлен на публикацию. Статус обновится автоматически."
      });
    } catch (error: any) {
      toast({
        title: "Ошибка",
        description: `Не удалось опубликовать контент: ${error.message}`,
        variant: "destructive"
      });
      
      setPublishResult({
        error: true,
        message: error.message
      });
      setIsResultOpen(true);
    } finally {
      setIsPublishing(false);
    }
  };
  
  // Формирование отображения результатов публикации
  const renderPublishResults = () => {
    if (!publishResult) return null;
    
    if (publishResult.error) {
      return (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Ошибка публикации</AlertTitle>
          <AlertDescription>{publishResult.message}</AlertDescription>
        </Alert>
      );
    }
    
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Результаты публикации:</h3>
        {Object.keys(publishResult.results || {}).map((platform) => {
          const result = publishResult.results[platform];
          const isSuccess = result.status === 'published';
          
          return (
            <div key={platform} className="p-3 border rounded-md">
              <div className="flex items-center gap-2 mb-2">
                {isSuccess ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <h4 className="font-medium capitalize">{platform}</h4>
              </div>
              
              {isSuccess ? (
                <div className="text-sm">
                  <p>Статус: Опубликовано</p>
                  {result.postUrl && (
                    <p>
                      <a 
                        href={result.postUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        Ссылка на публикацию
                      </a>
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-red-500">
                  Ошибка: {result.error || 'Неизвестная ошибка'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  
  return (
    <div className="container py-6">
      <Card>
        <CardHeader>
          <CardTitle>Тестовая публикация в социальные сети</CardTitle>
          <CardDescription>
            Создайте и опубликуйте тестовый контент в выбранные социальные сети
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="title">Заголовок</Label>
              <Input
                id="title"
                placeholder="Введите заголовок публикации"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            
            <div>
              <Label htmlFor="content">Содержание</Label>
              <Textarea
                id="content"
                placeholder="Введите текст публикации"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isImage"
                checked={isImage}
                onCheckedChange={(checked) => setIsImage(!!checked)}
              />
              <Label htmlFor="isImage">Добавить изображение</Label>
            </div>
            
            {isImage && (
              <div>
                <Label htmlFor="imageUrl">URL изображения</Label>
                <Input
                  id="imageUrl"
                  placeholder="Вставьте URL изображения"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
            )}
            
            <div>
              <Label>Выберите платформы для публикации</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="telegram"
                    checked={selectedPlatforms.telegram}
                    onCheckedChange={(checked) => 
                      setSelectedPlatforms({...selectedPlatforms, telegram: !!checked})
                    }
                  />
                  <Label htmlFor="telegram">Telegram</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="vk"
                    checked={selectedPlatforms.vk}
                    onCheckedChange={(checked) => 
                      setSelectedPlatforms({...selectedPlatforms, vk: !!checked})
                    }
                  />
                  <Label htmlFor="vk">ВКонтакте</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="instagram"
                    checked={selectedPlatforms.instagram}
                    onCheckedChange={(checked) => 
                      setSelectedPlatforms({...selectedPlatforms, instagram: !!checked})
                    }
                  />
                  <Label htmlFor="instagram">Instagram</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="facebook"
                    checked={selectedPlatforms.facebook}
                    onCheckedChange={(checked) => 
                      setSelectedPlatforms({...selectedPlatforms, facebook: !!checked})
                    }
                  />
                  <Label htmlFor="facebook">Facebook</Label>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={createTestContent}
            disabled={isPublishing || !title || !content || !selectedCampaign}
            className="w-full"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Публикация...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Опубликовать
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
      
      <Dialog open={isResultOpen} onOpenChange={setIsResultOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Результаты публикации</DialogTitle>
            <DialogDescription>
              Информация о результатах публикации в социальные сети
            </DialogDescription>
          </DialogHeader>
          {renderPublishResults()}
        </DialogContent>
      </Dialog>
    </div>
  );
}