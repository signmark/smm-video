import React, { useEffect, useState, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TransparentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
  className?: string;
  position?: { x: number; y: number };
}

export function TransparentDialog({
  isOpen,
  onClose,
  title,
  children,
  width = 600,
  height = 500,
  className,
  position,
}: TransparentDialogProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isFront, setIsFront] = useState(true);
  const [localPosition, setLocalPosition] = useState({ x: 0, y: 0 });
  const resizableRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width, height });
  const initialRef = useRef<{ x: number; y: number } | null>(null);
  const initialSize = useRef<{ width: number; height: number } | null>(null);
  
  // Направления изменения размера
  const [resizing, setResizing] = useState<string | null>(null);
  
  // Устанавливаем начальную позицию при открытии окна
  useEffect(() => {
    if (isOpen) {
      // Если передана позиция, используем её, иначе центрируем окно
      if (position) {
        setLocalPosition(position);
      } else {
        // Центрируем окно по центру экрана
        const x = window.innerWidth / 2 - size.width / 2;
        const y = window.innerHeight / 2 - size.height / 2;
        setLocalPosition({ x, y });
      }
      
      // Устанавливаем начальный размер
      setSize({ width, height });
      
      // Вьиносим диалог на передний план при открытии
      setIsFront(true);
    }
  }, [isOpen, position, width, height]);
  
  // Обработчик начала перетаскивания
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && e.target.closest('.handle')) {
      e.preventDefault();
      setIsDragging(true);
      setIsFront(true); // Выносим на передний план при начале перетаскивания
      
      // Сохраняем начальную позицию курсора и элемента
      const startPos = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elemX: localPosition.x,
        elemY: localPosition.y
      };
      
      // Функция для обработки движения мыши
      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Вычисляем смещение курсора относительно начальной позиции
        const deltaX = moveEvent.clientX - startPos.mouseX;
        const deltaY = moveEvent.clientY - startPos.mouseY;
        
        // Обновляем позицию элемента
        setLocalPosition({
          x: startPos.elemX + deltaX,
          y: startPos.elemY + deltaY
        });
      };
      
      // Функция для завершения перетаскивания
      const handleMouseUp = () => {
        setIsDragging(false);
        // Удаляем обработчики событий
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      // Добавляем обработчики событий
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
  };
  
  // Обработчик нажатия на диалог для выноса на передний план
  const handleDialogClick = () => {
    setIsFront(true);
  };
  
  // Обработчик начала изменения размера
  const startResizing = (direction: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(direction);
    setIsFront(true); // Выносим на передний план при изменении размера
    
    // Сохраняем начальную позицию курсора
    initialRef.current = { x: e.clientX, y: e.clientY };
    
    // Сохраняем начальный размер
    initialSize.current = { width: size.width, height: size.height };
    
    // Добавляем обработчики движения мыши и отпускания кнопки на document
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };
  
  // Обработчик изменения размера
  const handleMouseMove = (e: MouseEvent) => {
    if (resizing && initialRef.current && initialSize.current) {
      const deltaX = e.clientX - initialRef.current.x;
      const deltaY = e.clientY - initialRef.current.y;
      
      const newSize = { ...size };
      const newPosition = { ...localPosition };
      
      // Изменяем размер в зависимости от направления
      switch (resizing) {
        case 'right':
          newSize.width = Math.max(200, initialSize.current.width + deltaX);
          break;
        case 'left':
          const newWidth = Math.max(200, initialSize.current.width - deltaX);
          if (newWidth !== size.width) {
            newPosition.x = localPosition.x + (initialSize.current.width - newWidth);
            newSize.width = newWidth;
          }
          break;
        case 'bottom':
          newSize.height = Math.max(100, initialSize.current.height + deltaY);
          break;
        case 'top':
          const newHeight = Math.max(100, initialSize.current.height - deltaY);
          if (newHeight !== size.height) {
            newPosition.y = localPosition.y + (initialSize.current.height - newHeight);
            newSize.height = newHeight;
          }
          break;
        case 'bottom-right':
          newSize.width = Math.max(200, initialSize.current.width + deltaX);
          newSize.height = Math.max(100, initialSize.current.height + deltaY);
          break;
        case 'bottom-left':
          newSize.height = Math.max(100, initialSize.current.height + deltaY);
          const newWidthBL = Math.max(200, initialSize.current.width - deltaX);
          if (newWidthBL !== size.width) {
            newPosition.x = localPosition.x + (initialSize.current.width - newWidthBL);
            newSize.width = newWidthBL;
          }
          break;
        case 'top-right':
          newSize.width = Math.max(200, initialSize.current.width + deltaX);
          const newHeightTR = Math.max(100, initialSize.current.height - deltaY);
          if (newHeightTR !== size.height) {
            newPosition.y = localPosition.y + (initialSize.current.height - newHeightTR);
            newSize.height = newHeightTR;
          }
          break;
        case 'top-left':
          const newWidthTL = Math.max(200, initialSize.current.width - deltaX);
          const newHeightTL = Math.max(100, initialSize.current.height - deltaY);
          
          if (newWidthTL !== size.width) {
            newPosition.x = localPosition.x + (initialSize.current.width - newWidthTL);
            newSize.width = newWidthTL;
          }
          
          if (newHeightTL !== size.height) {
            newPosition.y = localPosition.y + (initialSize.current.height - newHeightTL);
            newSize.height = newHeightTL;
          }
          break;
      }
      
      setSize(newSize);
      setLocalPosition(newPosition);
    }
  };
  
  // Обработчик завершения изменения размера
  const stopResizing = () => {
    setResizing(null);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  };
  
  // Останавливаем распространение события для дочерних элементов, чтобы не мешать перетаскиванию
  const handleChildrenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  if (!isOpen) return null;
  
  // Позиция больше не нужна для управления Draggable, так как используем собственную реализацию
  
  // Стиль для элементов изменения размера
  const resizerStyle = "absolute w-3 h-3 bg-primary/60 rounded-full z-50";
  
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" onClick={handleDialogClick}>
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      
      <div
        ref={resizableRef}
        className={cn(
          "absolute rounded-lg overflow-hidden shadow-xl",
          "bg-background/80 backdrop-blur-md border border-border",
          isFront ? "z-50" : "z-40",
          isDragging ? "cursor-grabbing" : "",
          className
        )}
        style={{
          width: `${size.width}px`,
          height: `${size.height}px`,
          left: `${localPosition.x}px`,
          top: `${localPosition.y}px`
        }}
      >
        {/* Заголовок (хэндл для перетаскивания) */}
        <div 
          className="handle flex items-center justify-between px-4 py-2 bg-muted/80 cursor-grab border-b border-border" 
          onMouseDown={handleDragStart}
        >
          <h2 className="text-base font-medium">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Содержимое диалога */}
        <div 
          className="p-4 overflow-auto"
          style={{ height: `calc(${size.height}px - 2.5rem)` }} // 2.5rem - высота заголовка
          onClick={handleChildrenClick}
        >
          {children}
        </div>
        
        {/* Элементы для изменения размера */}
        <div className={`${resizerStyle} bottom-1 right-1 cursor-se-resize`} onMouseDown={startResizing('bottom-right')} />
        <div className={`${resizerStyle} bottom-1 left-1 cursor-sw-resize`} onMouseDown={startResizing('bottom-left')} />
        <div className={`${resizerStyle} top-1 right-1 cursor-ne-resize`} onMouseDown={startResizing('top-right')} />
        <div className={`${resizerStyle} top-1 left-1 cursor-nw-resize`} onMouseDown={startResizing('top-left')} />
        
        {/* Дополнительные элементы для изменения размера по сторонам */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary/60 cursor-e-resize" onMouseDown={startResizing('right')} />
        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary/60 cursor-w-resize" onMouseDown={startResizing('left')} />
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-8 bg-primary/60 cursor-s-resize" onMouseDown={startResizing('bottom')} />
        <div className="absolute top-1 left-1/2 -translate-x-1/2 h-1 w-8 bg-primary/60 cursor-n-resize" onMouseDown={startResizing('top')} />
      </div>
    </div>
  );
}