import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  FileText, 
  Image, 
  Video, 
  Layers,
  Calendar,
  Film,
  Smartphone
} from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

interface ContentTypeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectType: (type: 'text' | 'text-image' | 'image' | 'video' | 'clip' | 'story') => void;
}

export default function ContentTypeDialog({ isOpen, onClose, onSelectType }: ContentTypeDialogProps) {
  const { featureFlags, isEnabled } = useFeatureFlags();
  
  const contentTypes = [
    {
      id: 'text',
      title: 'Текст',
      description: 'Только текстовый контент без изображений',
      icon: FileText,
      color: 'bg-blue-50 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/30 dark:border-blue-800 dark:hover:bg-blue-900/50'
    },
    {
      id: 'text-image',
      title: 'Текст с картинкой',
      description: 'Текстовая публикация с изображениями',
      icon: Image,
      color: 'bg-green-50 border-green-200 hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800 dark:hover:bg-green-900/50'
    },
    {
      id: 'image',
      title: 'Только картинка',
      description: 'Публикация только изображения без текста',
      icon: Image,
      color: 'bg-orange-50 border-orange-200 hover:bg-orange-100 dark:bg-orange-950/30 dark:border-orange-800 dark:hover:bg-orange-900/50'
    },
    {
      id: 'clip',
      title: 'Короткое видео',
      description: 'Shorts, Reels, Clips - вертикальное видео до 60 сек',
      icon: Smartphone,
      color: 'bg-pink-50 border-pink-200 hover:bg-pink-100 dark:bg-pink-950/30 dark:border-pink-800 dark:hover:bg-pink-900/50'
    },
    {
      id: 'video',
      title: 'Длинное видео',
      description: 'Полноценные видео для YouTube, VK, Telegram',
      icon: Film,
      color: 'bg-red-50 border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-800 dark:hover:bg-red-900/50'
    },
    {
      id: 'story',
      title: 'Stories',
      description: 'Истории для Instagram, VK, Facebook',
      icon: Layers,
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100 dark:bg-purple-950/30 dark:border-purple-800 dark:hover:bg-purple-900/50'
    }
  ];

  const handleSelect = (type: 'text' | 'text-image' | 'image' | 'video' | 'clip' | 'story') => {
    onSelectType(type);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="pb-1">
          <DialogTitle>Выберите тип контента</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-1.5">
          {contentTypes.map((type) => {
            const IconComponent = type.icon;
            
            if (type.id === 'story' && !isEnabled('instagramStories')) {
              return (
                <Card key={type.id} className="opacity-50 cursor-not-allowed bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                  <CardContent className="p-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700">
                        <IconComponent className="w-4 h-4 text-gray-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-gray-500">{type.title}</h3>
                        <p className="text-xs text-gray-400">Функция временно отключена</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }
            
            return (
              <Card 
                key={type.id}
                className={`cursor-pointer transition-colors ${type.color}`}
                onClick={() => handleSelect(type.id as 'text' | 'text-image' | 'image' | 'video' | 'clip' | 'story')}
              >
                <CardContent className="p-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-white dark:bg-gray-800">
                      <IconComponent className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">{type.title}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{type.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}