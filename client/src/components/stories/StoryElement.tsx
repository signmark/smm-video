import React from 'react';
import DraggableWrapper from './DraggableWrapper';
import { Button } from '@/components/ui/button';
import { Trash2, Move } from 'lucide-react';

interface StoryElement {
  id: string;
  type: 'text' | 'image' | 'video' | 'poll' | 'quiz';
  position: { x: number; y: number };
  rotation: number;
  zIndex: number;
  content: any;
  style?: any;
}

interface StoryElementProps {
  element: StoryElement;
  isSelected: boolean;
  onSelect: (elementId: string) => void;
  onUpdate: (elementId: string, updates: Partial<StoryElement>) => void;
  onDelete: (elementId: string) => void;
}

export default function StoryElement({ 
  element, 
  isSelected, 
  onSelect, 
  onUpdate, 
  onDelete 
}: StoryElementProps) {
  
  const handleDrag = (e: any, data: any) => {
    onUpdate(element.id, {
      position: { x: data.x, y: data.y }
    });
  };

  const renderContent = () => {
    switch (element.type) {
      case 'text':
        return (
          <div 
            style={{
              fontSize: element.style?.fontSize || 16,
              color: element.style?.color || '#000000',
              fontFamily: element.style?.fontFamily || 'Arial',
              fontWeight: element.style?.fontWeight || 'normal',
              textAlign: element.style?.textAlign || 'center',
              padding: '8px',
              minWidth: '100px',
              background: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
              border: isSelected ? '2px dashed #6366f1' : '2px dashed transparent',
              borderRadius: '4px'
            }}
          >
            {element.content?.text || 'Текст'}
          </div>
        );
      
      case 'image':
        return (
          <div 
            style={{
              width: '120px',
              height: '120px',
              backgroundColor: '#f3f4f6',
              border: isSelected ? '2px dashed #6366f1' : '2px dashed transparent',
              borderRadius: element.style?.borderRadius || '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280'
            }}
          >
            {element.content?.url ? (
              <img 
                src={element.content.url} 
                alt={element.content.alt || 'Image'} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: element.style?.borderRadius || '8px' }}
              />
            ) : (
              'Изображение'
            )}
          </div>
        );
      
      case 'poll':
        return (
          <div 
            style={{
              backgroundColor: element.style?.backgroundColor || 'rgba(255, 255, 255, 0.9)',
              borderRadius: element.style?.borderRadius || '12px',
              padding: element.style?.padding || '16px',
              border: isSelected ? '2px dashed #6366f1' : '2px dashed transparent',
              minWidth: '200px'
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              {element.content?.question || 'Ваш вопрос?'}
            </div>
            {(element.content?.options || ['Вариант 1', 'Вариант 2']).map((option: string, index: number) => (
              <div key={index} style={{ 
                padding: '4px 8px', 
                margin: '4px 0', 
                backgroundColor: '#f3f4f6', 
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                {option}
              </div>
            ))}
          </div>
        );
      
      case 'quiz':
        return (
          <div 
            style={{
              backgroundColor: element.style?.backgroundColor || 'rgba(255, 255, 255, 0.9)',
              borderRadius: element.style?.borderRadius || '12px',
              padding: element.style?.padding || '16px',
              border: isSelected ? '2px dashed #6366f1' : '2px dashed transparent',
              minWidth: '200px'
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              {element.content?.question || 'Вопрос викторины?'}
            </div>
            {(element.content?.options || ['Вариант 1', 'Вариант 2', 'Вариант 3']).map((option: string, index: number) => (
              <div key={index} style={{ 
                padding: '4px 8px', 
                margin: '4px 0', 
                backgroundColor: index === element.content?.correctAnswer ? '#dcfce7' : '#f3f4f6', 
                borderRadius: '4px',
                fontSize: '14px'
              }}>
                {option}
              </div>
            ))}
          </div>
        );
      
      default:
        return (
          <div style={{
            padding: '8px',
            backgroundColor: '#f3f4f6',
            border: isSelected ? '2px dashed #6366f1' : '2px dashed transparent',
            borderRadius: '4px'
          }}>
            Элемент
          </div>
        );
    }
  };

  return (
    <DraggableWrapper
      position={element.position}
      onDrag={handleDrag}
      handle=".drag-handle"
    >
      <div
        style={{
          position: 'absolute',
          transform: `rotate(${element.rotation}deg)`,
          zIndex: element.zIndex,
          cursor: 'pointer'
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(element.id);
        }}
      >
        {renderContent()}
        
        {isSelected && (
          <div className="absolute -top-8 -right-8 flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              className="drag-handle h-6 w-6 p-0"
            >
              <Move className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(element.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </DraggableWrapper>
  );
}