# Руководство по реализации Emoji Picker

Данная документация описывает реализацию компонента выбора эмодзи в нашем приложении SMM Manager, который решает несколько ключевых проблем:

1. Правильное отображение и выбор эмодзи
2. Корректный скроллинг внутри компонента
3. Поддержка выбора категорий эмодзи
4. Возможность многократного добавления эмодзи без закрытия диалога

## Стек технологий

- **React** - основа компонента
- **emoji-picker-react** - библиотека с готовым пикером эмодзи
- **shadcn/ui** - компоненты UI (Popover, Button, Tooltip)
- **Tailwind CSS** - стилизация компонента

## Реализация

### 1. Структура компонента

Компонент представляет собой обертку над `emoji-picker-react` с использованием Popover из `shadcn/ui` для создания выпадающего окна. Ключевой прием - использование ref и обработчиков событий для корректной работы скроллинга.

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Smile } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import EmojiPickerComponent from 'emoji-picker-react';
import { Theme } from 'emoji-picker-react';
import { useThemeStore } from '@/lib/themeStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
}

export function EmojiPicker({ onEmojiSelect }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { colorMode } = useThemeStore();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Обработчик скроллинга
  useEffect(() => {
    if (!isOpen) return;
    
    const handleWheel = (e: WheelEvent) => {
      if (containerRef.current && containerRef.current.contains(e.target as Node)) {
        const emojiBody = containerRef.current.querySelector('.epr-body') as HTMLElement;
        
        if (emojiBody) {
          // Прокрутка содержимого эмодзи-пикера
          emojiBody.scrollTop += e.deltaY;
          
          // Предотвращаем прокрутку страницы
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    
    // Добавляем слушатель события колеса мыши
    document.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      // Удаляем слушатель при закрытии
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen]);
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                className="h-8 px-2"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Эмодзи</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <PopoverContent 
        className="w-auto p-0 emoji-popover" 
        side="bottom" 
        align="start"
        onClick={(e) => e.stopPropagation()} // Предотвращаем закрытие при клике
      >
        <div 
          ref={containerRef}
          className="emoji-picker-container"
          onClick={(e) => e.stopPropagation()} // Дублируем для надежности
        >
          <EmojiPickerComponent
            onEmojiClick={(emojiObject) => {
              // Вставляем эмодзи без закрытия пикера
              onEmojiSelect(emojiObject.emoji);
            }}
            searchPlaceholder="Поиск эмодзи..."
            width={320}
            height={350}
            previewConfig={{
              showPreview: true,
              defaultCaption: 'Выберите эмодзи',
            }}
            theme={colorMode === 'dark' ? Theme.DARK : Theme.LIGHT}
            skinTonesDisabled={false}
            lazyLoadEmojis={true}
            className="emoji-picker-react-component"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

### 2. CSS стили

Для корректной работы компонента необходимо определить следующие стили в `index.css`:

```css
/* Упрощенные стили для эмодзи-пикера в Popover */
.emoji-picker-container {
  position: relative;
  z-index: 50; 
}

/* Стили для Popover контейнера */
.emoji-popover {
  z-index: 50;
  max-height: 450px;
  overflow: visible;
}

/* Стили для компонента эмодзи-пикера */
.emoji-picker-react-component {
  border: none !important;
  box-shadow: none !important;
  --epr-hover-bg-color: var(--accent) !important;
  --epr-focus-bg-color: var(--accent) !important;
  --epr-highlight-color: var(--primary) !important;
  --epr-search-border-color: var(--border) !important;
}

/* Стили для скроллбара эмодзи-пикера - Chrome и Safari */
.emoji-picker-container .epr-body::-webkit-scrollbar {
  width: 6px;
}

.emoji-picker-container .epr-body::-webkit-scrollbar-track {
  background: transparent;
}

.emoji-picker-container .epr-body::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.5);
  border-radius: 6px;
}

/* Стили скроллбара - для Firefox */
.emoji-picker-container .epr-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.5) transparent;
  padding-right: 5px; /* Немного места для скроллбара */
}

/* Переопределяем шаблон событий для перехвата кликов */
.emoji-picker-container .EmojiPickerReact {
  pointer-events: auto !important;
}

.emoji-picker-container .epr-emoji {
  pointer-events: auto !important;
}

.emoji-picker-container .epr-category-nav {
  pointer-events: auto !important;
}
```

## Ключевые особенности реализации

### Решение проблем с скроллингом

Главная проблема, которую решает эта реализация - конфликт между скроллингом страницы и скроллингом внутри пикера. Когда пользователь прокручивает список эмодзи, скролл должен работать внутри компонента, а не на основной странице.

Реализован механизм перехвата событий колеса мыши (wheel events):

1. Используется `useRef` для получения ссылки на DOM-элемент контейнера
2. В `useEffect` добавляется обработчик события `wheel`
3. Внутри обработчика определяется, происходит ли событие внутри контейнера
4. Если да, то:
   - Прокручивается контент внутри пикера (.epr-body)
   - Предотвращается стандартная прокрутка страницы (e.preventDefault())
   - Останавливается распространение события (e.stopPropagation())
5. При закрытии пикера обработчик удаляется

### Предотвращение закрытия при клике на эмодзи

Вторая ключевая проблема - предотвращение закрытия пикера при клике на эмодзи или категории. Для этого:

1. Используется `stopPropagation()` на событии клика для PopoverContent
2. Дублируется остановка распространения события на контейнере
3. В обработчике `onEmojiClick` не вызывается `setIsOpen(false)`

## Использование компонента

Подключение компонента в форму или текстовый редактор:

```tsx
import { EmojiPicker } from '@/components/EmojiPicker';
import { useState } from 'react';

export function TextEditorExample() {
  const [text, setText] = useState('');
  
  const handleEmojiSelect = (emoji: string) => {
    setText(prev => prev + emoji);
  };
  
  return (
    <div>
      <textarea 
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full min-h-[200px] p-2"
      />
      <div className="flex items-center mt-2">
        <EmojiPicker onEmojiSelect={handleEmojiSelect} />
        <span className="ml-2">Добавить эмодзи</span>
      </div>
    </div>
  );
}
```

## Ключевые преимущества решения

1. **Улучшенный UX**: пользователи могут добавлять несколько эмодзи без необходимости повторно открывать пикер
2. **Правильный скроллинг**: прокрутка работает внутри компонента, не затрагивая основную страницу
3. **Тема**: поддержка светлой и темной темы
4. **Доступность**: компонент включает подсказки (tooltips) и работает с клавиатурой
5. **Поиск**: встроенный поиск эмодзи
6. **Категории**: возможность переключения между категориями эмодзи

## Как это реализовано в проекте

В проекте SMM Manager этот компонент используется в редакторе контента для социальных сетей, позволяя авторам легко добавлять эмодзи в посты. Эмодзи критически важны для современного SMM, поэтому удобный и функциональный пикер значительно улучшает пользовательский опыт.

## Распространенные проблемы и решения

### Проблема 1: Пикер закрывается при выборе эмодзи

**Решение**: Не вызывать `setIsOpen(false)` в обработчике `onEmojiClick`, а также использовать `stopPropagation()` на событии клика.

### Проблема 2: Скролл страницы при прокрутке эмодзи

**Решение**: Использовать обработчик события wheel через useEffect, который перенаправляет прокрутку внутрь контейнера эмодзи и предотвращает стандартное поведение.

### Проблема 3: Не работает выбор категорий

**Решение**: Добавление CSS правил, устанавливающих `pointer-events: auto !important` для нужных элементов.

## Заключение

Этот компонент демонстрирует, как можно улучшить пользовательский опыт путем внимательного подхода к деталям взаимодействия. Ключевые аспекты: управление фокусом, перехват событий и понимание внутренней структуры используемых библиотек.