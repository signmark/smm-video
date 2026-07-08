import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2, Instagram, MessageCircle, Send } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { SiVk, SiFacebook, SiThreads } from 'react-icons/si';
import type { SocialPlatform, CampaignContent } from '@/types';
import RichTextEditor from './RichTextEditor';
import { platformNames } from '@/lib/social-platforms';
import PlatformSelector from './PlatformSelector';

interface SocialPublishingPanelProps {
  content: CampaignContent;
  connectedPlatforms?: Record<string, boolean>;
  onClose?: () => void;
}

export function SocialPublishingPanel({ content, connectedPlatforms, onClose }: SocialPublishingPanelProps) {
  const { toast } = useToast();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({
    instagram: false,
    telegram: false,
    vk: false,
    facebook: false,
    youtube: false,
    threads: false
  });
  const [adaptedContent, setAdaptedContent] = useState<Record<SocialPlatform, string>>({
    instagram: content.content,
    telegram: content.content,
    vk: content.content,
    facebook: content.content,
    threads: content.content,
  });

  const { mutate: publishContent, isPending} = useMutation({
    mutationFn: async () => {
      const activePlatforms = Object.keys(selectedPlatforms).filter(p => selectedPlatforms[p]);
      if (activePlatforms.length === 0) {
        throw new Error('Выберите хотя бы одну платформу для публикации');
      }

      // Создаем объект публикаций для каждой выбранной платформы
      const publications = activePlatforms.reduce((acc, platform) => {
        acc[platform] = {
          platform,
          status: 'pending',
          content: adaptedContent[platform as SocialPlatform],
          publishedAt: null
        };
        return acc;
      }, {} as Record<string, any>);

      // Обновляем контент с информацией о публикациях через API сервера
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Требуется авторизация');
      }
      
      return await fetch(`/api/content/${content.id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          socialPlatforms: publications,
          status: 'scheduled'
        })
      }).then(response => {
        if (!response.ok) {
          throw new Error('Ошибка при публикации контента');
        }
        return response.json();
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaign-content'] });
      toast({
        title: 'Успешно',
        description: 'Контент запланирован для публикации'
      });
      if (onClose) onClose();
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: error.message || 'Не удалось запланировать публикацию'
      });
    }
  });

  const handlePlatformChange = (platform: string, isSelected: boolean) => {
    setSelectedPlatforms(prev => ({
      ...prev,
      [platform]: isSelected
    }));
  };

  const handleContentChange = (platform: SocialPlatform, newContent: string) => {
    setAdaptedContent({
      ...adaptedContent,
      [platform]: newContent
    });
  };

  // Функция для адаптации контента под особенности платформы
  const adaptContentForPlatform = (platform: SocialPlatform) => {
    let baseContent = content.content;
    
    switch (platform) {
      case 'instagram':
        // Instagram: добавляем хэштеги и эмодзи
        return `${baseContent}\n\n#content #socialmedia`;
        
      case 'telegram':
        // Telegram: сохраняем форматирование HTML, которое поддерживается в Telegram
        // Telegram поддерживает только <b>, <i>, <u>, <s>, <code>, <pre>, <a href>
        let formattedHtml = baseContent;
        
        // 1. Обработка ссылок - сначала обрабатываем их, чтобы сохранить href атрибуты
        const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
        formattedHtml = formattedHtml.replace(linkRegex, (match: any, url: any, text: any) => {
          return `<a href="${url}">${text}</a>`;
        });
        
        // 2. Заменяем эквивалентные теги на поддерживаемые Telegram форматы
        formattedHtml = formattedHtml
          .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '<b>$1</b>')
          .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '<b>$1</b>')
          .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '<i>$1</i>')
          .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '<i>$1</i>')
          .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '<u>$1</u>')
          .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '<u>$1</u>')
          .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '<s>$1</s>')
          .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '<s>$1</s>')
          .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '<s>$1</s>');
        
        // 3. Обрабатываем блочные элементы, добавляя переносы строк
        formattedHtml = formattedHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
          .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n')
          .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n');
        
        // 4. Обрабатываем списки
        formattedHtml = formattedHtml
          .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n')
          .replace(/<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/gi, '$1\n');
        
        // 5. Удаляем все оставшиеся HTML-теги, которые не поддерживаются Telegram
        const supportedTags = ['b', 'i', 'u', 's', 'code', 'pre', 'a'];
        const tagRegex = new RegExp(`<(?!\/?(?:${supportedTags.join('|')})(?:\\s|>))[^>]*>`, 'gi');
        formattedHtml = formattedHtml.replace(tagRegex, '');
        
        // 6. Проверяем баланс открывающих и закрывающих тегов
        const fixUnclosedTags = (html: string): string => {
          let result = html;
          
          // Простая проверка на балансировку тегов
          supportedTags.forEach(tag => {
            const openingTags = (result.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`,'gi')) || []).length;
            const closingTags = (result.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
            
            // Если открывающих тегов больше, добавляем закрывающие
            if (openingTags > closingTags) {
              const diff = openingTags - closingTags;
              result += `${Array(diff).fill(`</${tag}>`).join('')}`;
            }
          });
          
          return result;
        };
        
        formattedHtml = fixUnclosedTags(formattedHtml);
        
        // 7. Убираем лишние переносы строк (более 2 подряд)
        formattedHtml = formattedHtml.replace(/\n{3,}/g, '\n\n');
        
        return formattedHtml;
        
      case 'vk':
        // VK: стандартный текст
        return baseContent;
        
      case 'facebook':
        // Facebook: более формальный стиль
        return baseContent;

      case 'threads':
        // Threads: до 500 символов, хэштеги приветствуются
        return `${baseContent}\n\n#threads`;

      default:
        return baseContent;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Публикация в социальные сети</CardTitle>
        <CardDescription>
          Выберите платформы для публикации контента и настройте его для каждой из них
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PlatformSelector
          selectedPlatforms={selectedPlatforms}
          onChange={handlePlatformChange}
          content={{
            contentType: content.contentType,
            imageUrl: content.imageUrl ?? undefined,
            images: content.images,
            videoUrl: content.videoUrl ?? undefined,
          }}
          connectedPlatforms={connectedPlatforms as any}
        />

        {Object.entries(selectedPlatforms)
          .filter(([_, isSelected]) => isSelected)
          .map(([platform]) => (
            <div key={platform} className="space-y-2">
              <Label className="flex items-center gap-2">
                Контент для {platformNames[platform as keyof typeof platformNames] || platform}
              </Label>
              <RichTextEditor
                content={adaptedContent[platform]}
                onChange={(html: string) => handleContentChange(platform, html)}
                placeholder={`Введите контент для ${platformNames[platform as keyof typeof platformNames] || platform}`}
                minHeight={150}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleContentChange(platform, adaptContentForPlatform(platform))}
                className="w-full"
              >
                Автоматически адаптировать
              </Button>
            </div>
          ))}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button 
          onClick={() => publishContent()} 
          disabled={isPending || selectedPlatforms.length === 0}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Публикация...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Опубликовать
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}