# Руководство по интеграции AdditionalMediaUploader

## Общие сведения

`AdditionalMediaUploader` - это универсальный компонент для управления коллекцией медиа-элементов (изображений и видео), 
заменяющий отдельные компоненты для изображений и видео.

## Основные возможности

- Загрузка и управление изображениями и видео в едином интерфейсе
- Предпросмотр медиа-контента
- Добавление метаданных к медиа-элементам (заголовок, описание)
- Сортировка элементов для изменения порядка публикации

## Установка

Компонент уже включен в проект и не требует дополнительной установки.

## Использование

### Базовое использование

```tsx
import { AdditionalMediaUploader } from '@/components/AdditionalMediaUploader';
import { MediaItem } from '@/types';

// Создание состояния для хранения медиа-элементов
const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);

// Использование компонента
<AdditionalMediaUploader
  media={mediaItems}
  onChange={setMediaItems}
  label="Изображения и видео"
/>
```

### Интеграция в форму редактирования контента

```tsx
<div className="space-y-2">
  <Label htmlFor="additionalMedia">Медиа-файлы</Label>
  <AdditionalMediaUploader
    media={content.additionalMedia || []}
    onChange={(media) => setContent({...content, additionalMedia: media})}
    label="Изображения и видео"
  />
</div>
```

### Полная интеграция с опциональной поддержкой устаревших полей

```tsx
{/* Универсальное поле additional_media */}
<div className="mt-6 space-y-2 border-t pt-4">
  <div className="flex items-center justify-between">
    <Label htmlFor="additionalMedia">Универсальные медиа-файлы</Label>
    <Badge variant="outline" className="text-xs">Новое</Badge>
  </div>
  <AdditionalMediaUploader
    media={currentContent.additionalMedia || []}
    onChange={(media) => setCurrentContentSafe({...currentContent, additionalMedia: media})}
    label="Изображения и видео"
  />
  <p className="text-xs text-muted-foreground">
    Добавьте дополнительные изображения и видео для публикации в социальных сетях
  </p>
</div>

{/* Устаревшие компоненты, скрытые от пользователя */}
<div className="hidden">
  <AdditionalImagesUploader
    images={currentContent.additionalImages || []}
    onChange={(images) => setCurrentContentSafe({...currentContent, additionalImages: images})}
  />
  <AdditionalVideosUploader
    videos={currentContent.additionalVideos || []}
    onChange={(videos) => setCurrentContentSafe({...currentContent, additionalVideos: videos})}
  />
</div>
```

## Структура данных

Компонент работает с массивом объектов типа `MediaItem`:

```typescript
interface MediaItem {
  url: string;         // URL к медиа-файлу
  type: 'image' | 'video';   // Тип медиа (изображение или видео)
  title?: string;      // Опциональный заголовок
  description?: string; // Опциональное описание
}
```

## Функции обработчиков

### Обработка события изменения

```typescript
const handleMediaChange = (media: MediaItem[]) => {
  // Обновление состояния
  setCurrentContent({...currentContent, additionalMedia: media});
  
  // Опционально: синхронизация с устаревшими полями для обратной совместимости
  const images = media.filter(item => item.type === 'image').map(item => item.url);
  const videos = media.filter(item => item.type === 'video').map(item => item.url);
  
  setCurrentContent(prev => ({
    ...prev,
    additionalImages: images,
    additionalVideos: videos
  }));
};
```

## Миграция с устаревших компонентов

### Преобразование устаревших данных в новый формат

```typescript
// Конвертация существующих additionalImages и additionalVideos в additionalMedia
const convertLegacyMediaToUniversal = (content) => {
  const additionalMedia = [];
  
  // Добавляем изображения
  if (Array.isArray(content.additionalImages)) {
    content.additionalImages.forEach(url => {
      additionalMedia.push({
        url,
        type: 'image',
        title: ''
      });
    });
  }
  
  // Добавляем видео
  if (Array.isArray(content.additionalVideos)) {
    content.additionalVideos.forEach(url => {
      additionalMedia.push({
        url,
        type: 'video',
        title: ''
      });
    });
  }
  
  return {
    ...content,
    additionalMedia
  };
};
```

## Советы и рекомендации

1. **Проверка данных**: Всегда используйте проверку на null/undefined перед доступом к additionalMedia:
   ```typescript
   const media = content.additionalMedia || [];
   ```

2. **Порядок элементов**: Порядок элементов в массиве соответствует порядку отображения. Используйте 
   возможность перетаскивания в интерфейсе для изменения порядка.

3. **Превью изображений**: Для оптимизации загрузки используйте миниатюры изображений в списке, 
   а полный размер только при просмотре.

4. **Обработка ошибок**: Добавьте обработку ошибок для случаев, когда медиа-файл недоступен:
   ```tsx
   <img 
     src={item.url} 
     alt={item.title || 'Image'} 
     onError={(e) => {
       e.currentTarget.src = '/placeholder-image.jpg';
     }}
   />
   ```

## Расширение функциональности

Компонент можно расширить для поддержки дополнительных типов медиа или метаданных:

```typescript
// Расширенная версия MediaItem
interface EnhancedMediaItem extends MediaItem {
  // Дополнительные поля
  duration?: number;   // Длительность для видео
  width?: number;      // Ширина
  height?: number;     // Высота
  alt?: string;        // Альтернативный текст для доступности
  tags?: string[];     // Теги для классификации
}
```