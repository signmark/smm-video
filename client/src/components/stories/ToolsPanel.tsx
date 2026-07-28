import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { 
  Type, 
  Image, 
  Palette, 
  Star, 
  BarChart3, 
  HelpCircle,
  Upload,
  Smile,
  Settings
} from 'lucide-react';
import { StorySlide } from '../../../shared/stories-schema';

interface ToolsPanelProps {
  currentSlide?: StorySlide;
  storyId?: string;
  onElementAdd: () => void;
}

export default function ToolsPanel({ currentSlide, storyId, onElementAdd }: ToolsPanelProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'elements' | 'background' | 'settings'>('elements');

  // Add element mutation
  const addElementMutation = useMutation({
    mutationFn: (elementData: any) =>
      apiRequest(`/api/stories/${storyId}/slides/${currentSlide?.id}/elements`, {
        method: 'POST',
        // apiRequest принимает `data`, а не `body` — иначе тело теряется.
        data: elementData,
      }),
    onSuccess: () => {
      onElementAdd();
      toast({
        title: 'Элемент добавлен',
        description: 'Элемент успешно добавлен на слайд'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось добавить элемент',
        variant: 'destructive'
      });
    }
  });

  // Update slide background mutation
  const updateBackgroundMutation = useMutation({
    mutationFn: (backgroundData: any) =>
      apiRequest(`/api/stories/${storyId}/slides/${currentSlide?.id}`, {
        method: 'PUT',
        data: { background: backgroundData },
      }),
    onSuccess: () => {
      onElementAdd(); // Refresh slide data
      toast({
        title: 'Фон обновлен',
        description: 'Фон слайда успешно обновлен'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось обновить фон',
        variant: 'destructive'
      });
    }
  });

  const handleAddTextElement = () => {
    if (!currentSlide) return;

    const textElement = {
      type: 'text',
      position: {
        x: 100,
        y: 200,
        width: 300,
        height: 80
      },
      rotation: 0,
      zIndex: 1,
      content: {
        text: 'Новый текст'
      },
      style: {
        fontSize: 24,
        fontFamily: 'Arial',
        fontWeight: 'normal',
        textAlign: 'center',
        color: '#000000'
      }
    };

    addElementMutation.mutate(textElement);
  };

  const handleAddImageElement = () => {
    if (!currentSlide) return;

    // For now, add a placeholder image element
    const imageElement = {
      type: 'image',
      position: {
        x: 50,
        y: 300,
        width: 200,
        height: 200
      },
      rotation: 0,
      zIndex: 1,
      content: {
        url: '', // Will be set when user uploads image
        alt: 'Загруженное изображение'
      }
    };

    addElementMutation.mutate(imageElement);
  };

  const handleAddStickerElement = () => {
    if (!currentSlide) return;

    const stickerElement = {
      type: 'sticker',
      position: {
        x: 150,
        y: 400,
        width: 80,
        height: 80
      },
      rotation: 0,
      zIndex: 2,
      content: {
        emoji: '😀'
      }
    };

    addElementMutation.mutate(stickerElement);
  };

  const handleBackgroundColorChange = (color: string) => {
    if (!currentSlide) return;

    const newBackground = {
      type: 'color',
      value: color
    };

    updateBackgroundMutation.mutate(newBackground);
  };

  const renderElementsTab = () => (
    <div className="space-y-3">
      <Button
        onClick={handleAddTextElement}
        disabled={!currentSlide || addElementMutation.isPending}
        className="w-full justify-start"
        variant="outline"
      >
        <Type className="w-4 h-4 mr-2" />
        Добавить текст
      </Button>

      <Button
        onClick={handleAddImageElement}
        disabled={!currentSlide || addElementMutation.isPending}
        className="w-full justify-start"
        variant="outline"
      >
        <Image className="w-4 h-4 mr-2" />
        Загрузить медиа
      </Button>

      <Button
        onClick={handleAddStickerElement}
        disabled={!currentSlide || addElementMutation.isPending}
        className="w-full justify-start"
        variant="outline"
      >
        <Smile className="w-4 h-4 mr-2" />
        Добавить стикер
      </Button>

      <Separator />

      <Button
        disabled
        className="w-full justify-start"
        variant="outline"
      >
        <BarChart3 className="w-4 h-4 mr-2" />
        Создать опрос
      </Button>

      <Button
        disabled
        className="w-full justify-start"
        variant="outline"
      >
        <HelpCircle className="w-4 h-4 mr-2" />
        Добавить вопрос
      </Button>

      <Separator />

      <div className="text-xs text-gray-500 p-2">
        Интерактивные элементы будут реализованы в следующих версиях
      </div>
    </div>
  );

  const renderBackgroundTab = () => (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium mb-2 block">
          Цвет фона
        </Label>
        <div className="grid grid-cols-4 gap-2">
          {[
            '#ffffff', '#000000', '#ff0000', '#00ff00',
            '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
            '#ffa500', '#800080', '#ffc0cb', '#a52a2a'
          ].map((color) => (
            <button
              key={color}
              className="w-8 h-8 rounded border-2 border-gray-300 hover:border-gray-500"
              style={{ backgroundColor: color }}
              onClick={() => handleBackgroundColorChange(color)}
              disabled={updateBackgroundMutation.isPending}
            />
          ))}
        </div>
      </div>

      <Separator />

      <Button
        disabled
        className="w-full justify-start"
        variant="outline"
      >
        <Upload className="w-4 h-4 mr-2" />
        Загрузить изображение
      </Button>

      <Button
        disabled
        className="w-full justify-start"
        variant="outline"
      >
        <Palette className="w-4 h-4 mr-2" />
        Градиенты
      </Button>

      <div className="text-xs text-gray-500 p-2">
        Дополнительные фоны будут доступны в следующих версиях
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-4">
      <div>
        <Label htmlFor="slide-duration" className="text-sm font-medium mb-2 block">
          Длительность слайда
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="slide-duration"
            type="number"
            min="1"
            max="15"
            value={currentSlide?.duration || 5}
            disabled
            className="w-20"
          />
          <span className="text-sm text-gray-500">сек</span>
        </div>
      </div>

      <Separator />

      <div className="text-xs text-gray-500 p-2">
        Дополнительные настройки будут доступны в следующих версиях
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-sm mb-3">Инструменты</h3>
        <div className="flex gap-1">
          <Button
            variant={activeTab === 'elements' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('elements')}
            className="text-xs px-2"
          >
            Элементы
          </Button>
          <Button
            variant={activeTab === 'background' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('background')}
            className="text-xs px-2"
          >
            Фон
          </Button>
          <Button
            variant={activeTab === 'settings' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('settings')}
            className="text-xs px-2"
          >
            <Settings className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!currentSlide ? (
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">Выберите слайд</p>
            <p className="text-xs mt-1">для использования инструментов</p>
          </div>
        ) : (
          <>
            {activeTab === 'elements' && renderElementsTab()}
            {activeTab === 'background' && renderBackgroundTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <div className="text-xs text-gray-500 text-center">
          Редактор историй v1.0
        </div>
      </div>
    </div>
  );
}