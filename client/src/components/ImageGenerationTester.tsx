import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from '@/lib/queryClient';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export function ImageGenerationTester() {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [numImages, setNumImages] = useState(1);
  const [model, setModel] = useState('sdxl');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [models, setModels] = useState<{id: string, name: string, description: string}[]>([]);
  const { toast } = useToast();

  // Загружаем список доступных моделей
  React.useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await apiRequest('/api/fal-ai-models');
        if (response.success && response.models) {
          setModels(response.models);
        }
      } catch (error) {
        console.error('Ошибка при получении списка моделей:', error);
      }
    };

    fetchModels();
  }, []);

  // Функция проверки статуса API
  const checkApiStatus = async () => {
    try {
      const response = await apiRequest('/api/fal-ai-status');
      if (response.success) {
        toast({
          title: 'Статус API',
          description: response.status.available 
            ? 'API FAL.AI доступно и работает' 
            : 'API FAL.AI недоступно: ' + response.status.message,
        });
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось проверить статус API',
        variant: 'destructive',
      });
    }
  };

  // Функция генерации изображений
  const generateImages = async () => {
    if (!prompt.trim()) {
      toast({
        title: 'Ошибка',
        description: 'Необходимо ввести промпт для генерации изображения',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setResults([]);

    try {
      const response = await apiRequest('/api/generate-universal-image', {
        method: 'POST',
        body: {
          prompt,
          negativePrompt,
          width,
          height,
          numImages,
          model
        }
      });

      if (response.success && response.data) {
        setResults(response.data);
        toast({
          title: 'Успех',
          description: `Сгенерировано ${response.data.length} изображений`,
        });
      } else {
        toast({
          title: 'Ошибка',
          description: response.error || 'Не удалось сгенерировать изображения',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось сгенерировать изображения',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model">Модель</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите модель" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div>
                      <span className="font-medium">{m.name}</span>
                      <p className="text-xs text-gray-500">{m.description}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Промпт</Label>
            <Textarea 
              id="prompt"
              placeholder="Подробно опишите, какое изображение вы хотите сгенерировать..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="negativePrompt">Отрицательный промпт</Label>
            <Textarea 
              id="negativePrompt"
              placeholder="Опишите, что вы НЕ хотите видеть на изображении..."
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Количество изображений: {numImages}</Label>
            <Slider 
              value={[numImages]} 
              min={1} 
              max={4} 
              step={1} 
              onValueChange={(values) => setNumImages(values[0])} 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="width">Ширина: {width}px</Label>
              <Slider 
                value={[width]} 
                min={512} 
                max={1024} 
                step={64} 
                onValueChange={(values) => setWidth(values[0])} 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="height">Высота: {height}px</Label>
              <Slider 
                value={[height]} 
                min={512} 
                max={1024} 
                step={64} 
                onValueChange={(values) => setHeight(values[0])} 
              />
            </div>
          </div>

          <div className="flex space-x-2 pt-2">
            <Button onClick={generateImages} disabled={isLoading} className="flex-1">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Генерация...
                </>
              ) : (
                'Сгенерировать'
              )}
            </Button>
            <Button variant="outline" onClick={checkApiStatus}>
              Проверить API
            </Button>
          </div>
        </div>

        <div className="md:col-span-2">
          <h3 className="text-lg font-medium mb-4">Результаты ({results.length})</h3>
          {isLoading && (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
          )}
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {results.map((url, index) => (
              <Card key={index} className="overflow-hidden">
                <CardContent className="p-0">
                  <img 
                    src={url} 
                    alt={`Сгенерированное изображение ${index + 1}`} 
                    className="w-full h-auto object-contain"
                    onError={(e) => {
                      // Обработка ошибки загрузки изображения
                      e.currentTarget.src = '/images/image-error.svg';
                      e.currentTarget.alt = 'Ошибка загрузки изображения';
                    }}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
          
          {results.length > 0 && (
            <div className="mt-4">
              <Label className="text-sm text-gray-500">
                Совет: кликните правой кнопкой мыши на изображение и выберите "Сохранить изображение как..." для сохранения
              </Label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}