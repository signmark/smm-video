import React, { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Trash2, RotateCw, Move, Square } from 'lucide-react';
import StoryElement from './StoryElement';

interface StorySlide {
  id: string;
  order: number;
  duration: number;
  background: {
    type: 'color' | 'image' | 'video';
    value: string;
  };
  elements: StoryElementType[];
}

interface StoryElementType {
  id: string;
  type: 'text' | 'image' | 'video' | 'poll' | 'quiz';
  position: { x: number; y: number };
  rotation: number;
  zIndex: number;
  content: any;
  style?: any;
}

interface StoryCanvasProps {
  slide?: StorySlide;
  storyId?: string;
  onSlideUpdate: () => void;
}

interface DragState {
  isDragging: boolean;
  elementId: string | null;
  startX: number;
  startY: number;
  startElementX: number;
  startElementY: number;
}

export default function StoryCanvas({ slide, storyId, onSlideUpdate }: StoryCanvasProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    elementId: null,
    startX: 0,
    startY: 0,
    startElementX: 0,
    startElementY: 0
  });

  // Update element mutation
  const updateElementMutation = useMutation({
    mutationFn: ({ elementId, data }: { elementId: string; data: any }) =>
      apiRequest(`/api/stories/${storyId}/slides/${slide?.id}/elements/${elementId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),
    onSuccess: () => {
      onSlideUpdate();
    },
    onError: (error: any) => {
      toast({
        title: 'Ошибка обновления',
        description: error.message || 'Не удалось обновить элемент',
        variant: 'destructive'
      });
    }
  });

  // Delete element mutation
  const deleteElementMutation = useMutation({
    mutationFn: (elementId: string) =>
      apiRequest(`/api/stories/${storyId}/slides/${slide?.id}/elements/${elementId}`, {
        method: 'DELETE'
      }),
    onSuccess: () => {
      setSelectedElementId(null);
      onSlideUpdate();
    },
    onError: (error: any) => {
      toast({
        title: 'Ошибка удаления',
        description: error.message || 'Не удалось удалить элемент',
        variant: 'destructive'
      });
    }
  });

  const handleMouseDown = useCallback((e: React.MouseEvent, elementId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const element = slide?.elements.find(el => el.id === elementId);
    if (!element) return;

    setSelectedElementId(elementId);
    setDragState({
      isDragging: true,
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      startElementX: element.position.x,
      startElementY: element.position.y
    });
  }, [slide?.elements]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.isDragging || !dragState.elementId) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    
    const newX = Math.max(0, Math.min(320 - 50, dragState.startElementX + deltaX));
    const newY = Math.max(0, Math.min(568 - 50, dragState.startElementY + deltaY));

    updateElementMutation.mutate({
      elementId: dragState.elementId,
      data: {
        position: { x: newX, y: newY }
      }
    });
  }, [dragState, updateElementMutation]);

  const handleMouseUp = useCallback(() => {
    setDragState({
      isDragging: false,
      elementId: null,
      startX: 0,
      startY: 0,
      startElementX: 0,
      startElementY: 0
    });
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedElementId(null);
    }
  }, []);

  const getBackgroundStyle = (background: StorySlide['background']) => {
    switch (background.type) {
      case 'color':
        return { backgroundColor: background.value };
      case 'image':
        return {
          backgroundImage: `url(${background.value})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        };
      case 'video':
        return { backgroundColor: '#000000' };
      default:
        return { backgroundColor: '#ffffff' };
    }
    return { backgroundColor: '#ffffff' };
  };

  const renderElements = () => {



    
    if (!slide?.elements || slide.elements.length === 0) {

      return (
        <div className="absolute inset-0 flex items-center justify-center text-white/70">
          <div className="text-center">
            <p className="text-lg font-medium">Нет элементов на слайде</p>
            <p className="text-sm">Добавьте элементы используя панель слева</p>
          </div>
        </div>
      );
    }


    return slide.elements.map((element, index) => {

      return (
        <StoryElement
          key={element.id}
          element={element}
          isSelected={selectedElementId === element.id}
          onSelect={setSelectedElementId}
          onUpdate={(elementId: string, updates: any) => {
            updateElementMutation.mutate({ elementId, data: updates });
          }}
          onDelete={(elementId: string) => {
            deleteElementMutation.mutate(elementId);
          }}
        />
      );
    });
  };

  if (!slide) {
    return (
      <Card className="w-80 h-[568px] flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">История не найдена</p>
          <p className="text-sm">Выберите историю для редактирования</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Canvas */}
      <Card className="w-80 h-[568px] overflow-hidden shadow-lg">
        <CardContent className="p-0 h-full">
          <div
            ref={canvasRef}
            className="relative w-full h-full"
            style={getBackgroundStyle(slide.background)}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
          >
            {/* Grid overlay (optional) */}
            <div 
              className="absolute inset-0 opacity-10 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(to right, #000 1px, transparent 1px),
                  linear-gradient(to bottom, #000 1px, transparent 1px)
                `,
                backgroundSize: '20px 20px'
              }}
            />

            {/* Render elements */}
            {renderElements()}
            
            {/* Canvas info overlay */}
            <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
              9:16 • {slide.duration}s
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Element controls */}
      {selectedElementId && (
        <Card className="w-80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Выбранный элемент
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const element = slide.elements.find(el => el.id === selectedElementId);
                    if (element) {
                      updateElementMutation.mutate({
                        elementId: selectedElementId,
                        data: {
                          rotation: (element.rotation + 90) % 360
                        }
                      });
                    }
                  }}
                >
                  <RotateCw className="w-4 h-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteElementMutation.mutate(selectedElementId)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}