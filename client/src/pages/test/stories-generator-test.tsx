import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StoriesImageGenerator } from '@/components/stories/StoriesImageGenerator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search } from 'lucide-react';

export default function StoriesGeneratorTest() {
  const [testStoryId, setTestStoryId] = useState(1);
  const [realStoryId, setRealStoryId] = useState('1d1a1b5c-8f25-4538-b76b-5b8d06113a5d');
  const [realStory, setRealStory] = useState<any>(null);
  const [isLoadingRealStory, setIsLoadingRealStory] = useState(false);
  const [useRealStory, setUseRealStory] = useState(false);
  const { toast } = useToast();

  // Тестовые данные для Stories с различными конфигурациями
  const testStories = [
    {
      id: 1,
      title: "Тест простого текста",
      image_url: "https://picsum.photos/1080/1920?random=1",
      textOverlays: [
        {
          id: "1",
          text: "Простой текст",
          x: 175,
          y: 300,
          fontSize: 32,
          color: "#ffffff",
          fontFamily: "Arial",
          fontWeight: "bold",
          textAlign: "center",
          backgroundColor: "transparent",
          rotation: 0
        }
      ]
    },
    {
      id: 2,
      title: "Тест с фоном текста",
      image_url: "https://picsum.photos/1080/1920?random=2",
      textOverlays: [
        {
          id: "1",
          text: "Текст с фоном",
          x: 175,
          y: 200,
          fontSize: 28,
          color: "#ffffff",
          fontFamily: "Arial",
          fontWeight: "bold",
          textAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          rotation: 0
        },
        {
          id: "2",
          text: "Второй текст",
          x: 175,
          y: 400,
          fontSize: 24,
          color: "#ffff00",
          fontFamily: "Arial",
          fontWeight: "normal",
          textAlign: "center",
          backgroundColor: "transparent",
          rotation: 15
        }
      ]
    },
    {
      id: 3,
      title: "Тест без фонового изображения",
      textOverlays: [
        {
          id: "1",
          text: "Только градиент",
          x: 175,
          y: 310,
          fontSize: 36,
          color: "#ffffff",
          fontFamily: "Arial",
          fontWeight: "bold",
          textAlign: "center",
          backgroundColor: "rgba(255, 0, 0, 0.3)",
          rotation: -10
        }
      ]
    },
    {
      id: 4,
      title: "Тест множественных элементов",
      image_url: "https://picsum.photos/1080/1920?random=3",
      textOverlays: [
        {
          id: "1",
          text: "Заголовок",
          x: 175,
          y: 150,
          fontSize: 40,
          color: "#ffffff",
          fontFamily: "Arial",
          fontWeight: "bold",
          textAlign: "center",
          backgroundColor: "rgba(0, 0, 0, 0.7)",
          rotation: 0
        },
        {
          id: "2",
          text: "Подзаголовок",
          x: 175,
          y: 250,
          fontSize: 24,
          color: "#ffff00",
          fontFamily: "Arial",
          fontWeight: "normal",
          textAlign: "center",
          backgroundColor: "transparent",
          rotation: 0
        },
        {
          id: "3",
          text: "Боковой текст",
          x: 80,
          y: 450,
          fontSize: 18,
          color: "#ff69b4",
          fontFamily: "Arial",
          fontWeight: "bold",
          textAlign: "left",
          backgroundColor: "rgba(255, 255, 255, 0.8)",
          rotation: 45
        },
        {
          id: "4",
          text: "Нижний текст",
          x: 175,
          y: 550,
          fontSize: 20,
          color: "#00ff00",
          fontFamily: "Arial",
          fontWeight: "normal",
          textAlign: "center",
          backgroundColor: "transparent",
          rotation: -5
        }
      ]
    }
  ];

  interface StoryData {
    id: number | string;
    title: string;
    image_url?: string;
    backgroundImageUrl?: string;
    textOverlays?: any[];
  }

  const loadRealStory = async () => {
    if (!realStoryId.trim()) {
      toast({
        title: "Ошибка",
        description: "Введите ID Stories",
        variant: "destructive"
      });
      return;
    }

    setIsLoadingRealStory(true);
    try {
      console.log('[TEST] Загружаем реальную Stories с ID:', realStoryId);
      
      const response = await fetch(`/api/stories/story/${realStoryId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error('Stories не найдена в ответе');
      }

      const story = result.data;
      console.log('[TEST] Загружена реальная Stories:', story);

      // Парсим metadata для получения textOverlays
      let textOverlays = [];
      if (story.metadata) {
        try {
          const metadata = typeof story.metadata === 'string' ? JSON.parse(story.metadata) : story.metadata;
          textOverlays = metadata.textOverlays || [];
          console.log('[TEST] Найдены textOverlays:', textOverlays);
        } catch (e) {
          console.warn('[TEST] Ошибка парсинга metadata:', e);
        }
      }

      // Формируем структуру как у тестовых Stories
      const formattedStory = {
        id: story.id,
        title: story.title || 'Реальная Stories',
        image_url: story.image_url,
        backgroundImageUrl: story.image_url, // дублируем для совместимости
        textOverlays: textOverlays
      };

      setRealStory(formattedStory);
      setUseRealStory(true);
      
      toast({
        title: "Успешно",
        description: `Stories "${story.title}" загружена (${textOverlays.length} текстовых элементов)`,
      });

    } catch (error) {
      console.error('[TEST] Ошибка загрузки реальной Stories:', error);
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : 'Не удалось загрузить Stories',
        variant: "destructive"
      });
    } finally {
      setIsLoadingRealStory(false);
    }
  };

  const currentStory: StoryData = useRealStory && realStory 
    ? realStory 
    : testStories.find(story => story.id === testStoryId) || testStories[0];

  const handleImageGenerated = (imageUrl: string) => {
    console.log('[TEST] Изображение сгенерировано:', imageUrl);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Тест Stories Image Generator</h1>
        <p className="text-muted-foreground">
          Тестирование генератора изображений для Stories отдельно от публикации
        </p>
      </div>

      {/* Загрузка реальной Stories */}
      <Card>
        <CardHeader>
          <CardTitle>Загрузить реальную Stories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Введите ID Stories (например: 1d1a1b5c-8f25-4538-b76b-5b8d06113a5d)"
              value={realStoryId}
              onChange={(e) => setRealStoryId(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={loadRealStory}
              disabled={isLoadingRealStory}
              className="flex items-center gap-2"
            >
              {isLoadingRealStory ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Загрузить
            </Button>
          </div>
          
          {realStory && (
            <div className="p-3 bg-green-50 rounded-lg text-green-800">
              ✅ Загружена: "{realStory.title}" ({realStory.textOverlays?.length || 0} текстовых элементов)
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setUseRealStory(false)}
              variant={!useRealStory ? "default" : "outline"}
              size="sm"
            >
              Тестовые данные
            </Button>
            <Button
              onClick={() => realStory && setUseRealStory(true)}
              variant={useRealStory ? "default" : "outline"}
              disabled={!realStory}
              size="sm"
            >
              Реальная Stories
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Переключатель тестовых сценариев */}
      {!useRealStory && (
        <Card>
          <CardHeader>
            <CardTitle>Выберите тестовый сценарий</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {testStories.map((story) => (
                <Button
                  key={story.id}
                  onClick={() => setTestStoryId(story.id)}
                  variant={testStoryId === story.id ? "default" : "outline"}
                  className="text-sm"
                >
                  {story.title}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Информация о текущем тесте */}
      <Card>
        <CardHeader>
          <CardTitle>
            {useRealStory ? '📋 Реальная Stories' : '🧪 Тестовые данные'}: {currentStory.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>ID:</strong> {currentStory.id}</p>
            <p><strong>Тип:</strong> {useRealStory ? 'Реальные данные из базы' : 'Тестовые данные'}</p>
            <p><strong>Фоновое изображение:</strong> {currentStory.image_url || currentStory.backgroundImageUrl || 'Градиент (нет изображения)'}</p>
            <p><strong>Количество текстовых элементов:</strong> {currentStory.textOverlays?.length || 0}</p>
            
            {(currentStory.textOverlays?.length ?? 0) > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2">Текстовые элементы:</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {(currentStory.textOverlays ?? []).map((overlay, index) => (
                    <div key={overlay.id} className="text-sm p-2 bg-muted rounded">
                      <p><strong>#{index + 1}:</strong> "{overlay.text}"</p>
                      <p className="text-xs text-muted-foreground">
                        Позиция: ({overlay.x}, {overlay.y}), 
                        Размер: {overlay.fontSize}px, 
                        Цвет: {overlay.color}, 
                        Поворот: {overlay.rotation}°
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Генератор изображений */}
      <Card>
        <CardHeader>
          <CardTitle>Stories Image Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <StoriesImageGenerator 
            story={currentStory}
            onImageGenerated={handleImageGenerated}
          />
        </CardContent>
      </Card>

      {/* Полезная информация */}
      <Card>
        <CardHeader>
          <CardTitle>Информация для тестирования</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>Canvas размер:</strong> 540x960 (половина от Instagram Stories формата)</p>
          <p><strong>JPEG качество:</strong> 30% (или 10% при больших файлах)</p>
          <p><strong>Масштабирование:</strong> Координаты из редактора (350x620) → финальный размер (540x960)</p>
          <p><strong>ImgBB лимит:</strong> Файлы больше 100KB сжимаются дополнительно</p>
          <p><strong>Fallback:</strong> При ошибке ImgBB показывается локальное изображение</p>
          <p className="mt-4 p-2 bg-yellow-50 rounded text-yellow-800">
            <strong>Проверьте консоль браузера</strong> для подробных логов процесса генерации
          </p>
        </CardContent>
      </Card>
    </div>
  );
}