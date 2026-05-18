import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Plus, Copy, Trash2, GripVertical } from 'lucide-react';
import { StorySlide } from '../../../shared/stories-schema';
import { useStoryStore } from '@/lib/storyStore';

interface SlidePanelProps {
  slides: StorySlide[];
  currentSlideIndex: number;
  onSlideSelect: (index: number) => void;
  storyId?: string;
}

export default function SlidePanel({ 
  slides, 
  currentSlideIndex, 
  onSlideSelect, 
  storyId 
}: SlidePanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { addSlide, deleteSlide } = useStoryStore();

  // Add new slide mutation
  const addSlideMutation = useMutation({
    mutationFn: (slideData: any) => 
      apiRequest(`/api/stories/${storyId}/slides`, {
        method: 'POST',
        body: JSON.stringify(slideData)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['story', storyId] });
      toast({
        title: 'Слайд добавлен',
        description: 'Новый слайд успешно добавлен в историю'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось добавить слайд',
        variant: 'destructive'
      });
    }
  });

  const handleAddSlide = () => {
    // Добавляем слайд только в локальный store - работа в памяти
    addSlide();
    
    toast({
      title: 'Слайд добавлен',
      description: 'Новый слайд добавлен (сохраните изменения для сохранения в БД)'
    });
  };

  const handleDuplicateSlide = (slideIndex: number) => {
    if (!slides[slideIndex]) return;

    const slideToClone = slides[slideIndex];
    
    // Работаем в памяти через store
    addSlide();
    
    toast({
      title: 'Слайд скопирован',
      description: 'Слайд скопирован (сохраните изменения для сохранения в БД)'
    });
  };

  const handleDeleteSlide = (slideIndex: number) => {
    if (!slides[slideIndex] || slides.length <= 1) {
      if (slides.length <= 1) {
        toast({
          title: 'Нельзя удалить',
          description: 'История должна содержать хотя бы один слайд',
          variant: 'destructive'
        });
      }
      return;
    }

    // Работаем в памяти через store
    deleteSlide(slideIndex);

    // Adjust current slide index if needed
    if (currentSlideIndex >= slides.length - 1) {
      onSlideSelect(Math.max(0, currentSlideIndex - 1));
    }
    
    toast({
      title: 'Слайд удален',
      description: 'Слайд удален (сохраните изменения для сохранения в БД)'
    });
  };

  const renderSlidePreview = (slide: StorySlide, index: number) => {
    const backgroundStyle = getBackgroundStyle(slide.background);
    
    return (
      <div
        key={slide.id}
        className={`relative group cursor-pointer transition-all duration-200 ${
          index === currentSlideIndex 
            ? 'ring-2 ring-blue-500 shadow-md' 
            : 'hover:shadow-sm'
        }`}
        onClick={() => onSlideSelect(index)}
      >
        <Card className="mb-2">
          <CardContent className="p-2">
            {/* Slide preview with 9:16 aspect ratio */}
            <div 
              className="w-full aspect-[9/16] rounded border-2 border-gray-200 relative overflow-hidden"
              style={backgroundStyle}
            >
              {/* Slide number */}
              <div className="absolute top-1 left-1 bg-black/50 text-white text-xs px-1 rounded">
                {index + 1}
              </div>
              
              {/* Duration indicator */}
              <div className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1 rounded">
                {slide.duration}s
              </div>

              {/* Elements preview (simplified) */}
              {slide.elements?.map((element, elementIndex) => (
                <div
                  key={element.id}
                  className="absolute bg-blue-200/50 border border-blue-300 rounded"
                  style={{
                    left: `${(element.position.x / 1080) * 100}%`,
                    top: `${(element.position.y / 1920) * 100}%`,
                    width: `${(element.position.width / 1080) * 100}%`,
                    height: `${(element.position.height / 1920) * 100}%`,
                    transform: `rotate(${element.rotation}deg)`,
                    zIndex: element.zIndex
                  }}
                >
                  {element.type === 'text' && (
                    <div className="text-xs truncate p-1">
                      {element.content?.text || 'Текст'}
                    </div>
                  )}
                  {element.type === 'image' && (
                    <div className="w-full h-full bg-gray-300 flex items-center justify-center text-xs">
                      IMG
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Slide controls */}
            <div className="flex items-center justify-between mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicateSlide(index);
                  }}
                  disabled={addSlideMutation.isPending}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSlide(index);
                  }}
                  disabled={slides.length <= 1}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <GripVertical className="w-4 h-4 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Слайды</h3>
          <span className="text-xs text-gray-500">{slides.length}</span>
        </div>
        <Button
          onClick={handleAddSlide}
          size="sm"
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Добавить слайд
        </Button>
      </div>

      {/* Slides list */}
      <div className="flex-1 overflow-y-auto p-4">
        {slides.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">Нет слайдов</p>
            <p className="text-xs mt-1">Добавьте первый слайд</p>
          </div>
        ) : (
          slides.map((slide, index) => renderSlidePreview(slide, index))
        )}
      </div>
    </div>
  );
}

// Helper function to convert background config to CSS style
function getBackgroundStyle(background: any): React.CSSProperties {
  if (!background) {
    return { backgroundColor: '#ffffff' };
  }

  switch (background.type) {
    case 'color':
      return { backgroundColor: background.value };
    
    case 'gradient':
      if (background.value.type === 'linear') {
        const angle = background.value.angle || 0;
        const colors = background.value.colors?.join(', ') || '#ffffff, #000000';
        return {
          background: `linear-gradient(${angle}deg, ${colors})`
        };
      } else if (background.value.type === 'radial') {
        const colors = background.value.colors?.join(', ') || '#ffffff, #000000';
        return {
          background: `radial-gradient(circle, ${colors})`
        };
      }
      break;
    
    case 'image':
      return {
        backgroundImage: `url(${background.value.url})`,
        backgroundSize: background.value.fit || 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      };
    
    case 'video':
      // For preview, show a placeholder
      return {
        backgroundColor: '#000000',
        backgroundImage: 'url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggNVYxOUwxOSAxMkw4IDVaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K)',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      };
    
    default:
      return { backgroundColor: '#ffffff' };
  }

  return { backgroundColor: '#ffffff' };
}