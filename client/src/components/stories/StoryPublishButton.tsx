import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { publishWithImageGeneration } from '@/utils/publishWithImageGeneration';

interface StoryPublishButtonProps {
  story: any;
  contentId: string;
  platforms?: string[];
  disabled?: boolean;
  onSave?: () => Promise<void>; // Функция для автосохранения перед публикацией
}

export const StoryPublishButton: React.FC<StoryPublishButtonProps> = ({
  story,
  contentId,
  platforms = ['instagram'],
  disabled = false,
  onSave
}) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const { toast } = useToast();

  const handlePublish = async () => {
    if (!contentId || !story) {
      toast({
        title: "Ошибка",
        description: "Нет данных для публикации",
        variant: "destructive"
      });
      return;
    }

    setIsPublishing(true);
    
    try {
      // Автоматически сохраняем перед публикацией
      if (onSave) {
        await onSave();
      }

      const result = await publishWithImageGeneration({
        contentId,
        platforms,
        story
      });
      
      if (result.success) {
        const mediaDescription = result.videoGenerated 
          ? 'с автоматически сгенерированным видео'
          : result.imageGenerated 
            ? 'с автоматически сгенерированным изображением'
            : '';
            
        toast({
          title: "Контент отправлен на публикацию",
          description: `Stories отправлена на публикацию ${mediaDescription}`.trim(),
        });
      } else {
        throw new Error(result.message || 'Ошибка публикации');
      }
      
    } catch (error) {
      toast({
        title: "Ошибка публикации",
        description: error instanceof Error ? error.message : 'Произошла ошибка при публикации',
        variant: "destructive"
      });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <Button
      onClick={handlePublish}
      disabled={disabled || isPublishing || !story?.textOverlays?.length}
      className="flex items-center gap-2"
    >
      {isPublishing ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Send className="w-4 h-4" />
      )}
      {isPublishing ? 'Публикация...' : 'Опубликовать'}
    </Button>
  );
};