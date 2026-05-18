# Техническое задание: Редактор Stories с Imgbb интеграцией

## Цель проекта
Реализовать полностью работающий редактор Stories в SMM Manager приложении с корректной интеграцией Imgbb для хранения изображений, где фоновые изображения загружаются на Imgbb и URL сохраняется в поле `image_url` базы данных.

## Ключевые требования

### 1. Архитектурные принципы
- **Разделение данных**: Фоновое изображение хранится в поле `image_url`, остальные данные Stories (текст, шрифт, цвет, расположение, дополнительные изображения) в поле `metadata`
- **Изменения только в браузере**: Все модификации сохраняются только в состоянии браузера до нажатия кнопки "Сохранить"
- **Imgbb для изображений**: Фоновые изображения загружаются на Imgbb, URL сохраняется в browser state
- **Сохранение по требованию**: Данные записываются в базу данных только при явном нажатии "Сохранить"

### 2. Структура данных

#### База данных (Directus collection: campaign_content)
```sql
- id (UUID)
- title (string) 
- image_url (string) - URL фонового изображения (Imgbb)
- metadata (JSON) - данные Stories (текст, дополнительные изображения, настройки)
- campaign_id (UUID)
- user_id (UUID)
- content_type = 'story'
- status ('draft', 'published', etc.)
- created_at, updated_at (timestamps)
```

#### Структура metadata поля:
```json
{
  "textOverlays": [
    {
      "id": "text1",
      "text": "Текст",
      "x": 100,
      "y": 200,
      "fontSize": 24,
      "color": "#ffffff",
      "fontFamily": "Arial",
      "fontWeight": "bold",
      "textAlign": "center",
      "backgroundColor": "rgba(0,0,0,0.5)",
      "padding": 10,
      "borderRadius": 5
    }
  ],
  "additionalImages": [
    {
      "id": "sticker1",
      "url": "https://i.ibb.co/xxx/sticker.png",
      "x": 50,
      "y": 300,
      "width": 100,
      "height": 100
    }
  ],
  "storyType": "instagram",
  "format": "9:16",
  "version": "1.0"
}
```

#### Компонент состояние (SimpleStoryData)
```typescript
type StoryState = 'idle' | 'loading' | 'saving' | 'error';

interface SimpleStoryData {
  // Фоновое изображение - отдельное поле
  backgroundImageUrl: string | null; // из поля image_url

  // Данные Stories - хранится в metadata
  textOverlays: TextOverlay[];
  additionalImages: AdditionalImage[];

  // Метаданные
  title: string;
  campaignId: string;
  storyId?: string;

  // Улучшенное управление состоянием
  state: StoryState;
  hasUnsavedChanges: boolean;
  error: string | null;
  validationErrors: Record<string, string>;
}

interface AdditionalImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontWeight: string;
  textAlign: string;
  backgroundColor: string;
  padding: number;
  borderRadius: number;
}

interface AdditionalImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Zod схемы для валидации
const TextOverlaySchema = z.object({
  id: z.string(),
  text: z.string().min(1, "Текст не может быть пустым"),
  x: z.number().min(0).max(1080),
  y: z.number().min(0).max(1920),
  fontSize: z.number().min(8).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Неверный формат цвета"),
  fontFamily: z.string(),
  fontWeight: z.string(),
  textAlign: z.enum(['left', 'center', 'right']),
  backgroundColor: z.string(),
  padding: z.number().min(0).max(50),
  borderRadius: z.number().min(0).max(50),
});

const StoryMetadataSchema = z.object({
  textOverlays: z.array(TextOverlaySchema),
  additionalImages: z.array(z.object({
    id: z.string(),
    url: z.string().url("Неверный URL изображения"),
    x: z.number().min(0).max(1080),
    y: z.number().min(0).max(1920),
    width: z.number().min(10).max(500),
    height: z.number().min(10).max(500),
  })),
  storyType: z.enum(['instagram', 'facebook', 'vk']),
  format: z.string(),
  version: z.string(),
});
```

### 3. API эндпоинты

#### GET /api/stories/:id
Загрузка существующей Story:
```typescript
Response: {
  success: true,
  data: {
    id: string,
    title: string,
    image_url: string | null, // Фоновое изображение
    metadata: string, // JSON строка с данными Stories
    // другие поля...
  }
}
```

#### PUT /api/stories/:id  
Обновление Story (только при нажатии "Сохранить"):
```typescript
Request: {
  title?: string,
  image_url?: string, // Фоновое изображение
  metadata?: string, // JSON с остальными данными Stories
  status?: string
}
```

#### POST /api/imgur/upload-file
Загрузка изображения на Imgbb (уже существует):
```typescript
Request: FormData с полем 'image'
Response: {
  url: string // URL загруженного изображения
}
```

### 4. Frontend компоненты

#### SimpleStoryEditor.tsx - основная логика:

1. **Загрузка данных**:
   ```typescript
   useEffect(() => {
     if (existingStory?.data) {
       const metadata = story.metadata ? JSON.parse(story.metadata) : {};
       setStoryData(prev => ({
         ...prev,
         title: story.title || 'Без названия',
         backgroundImageUrl: story.image_url || null, // из отдельного поля
         textOverlays: metadata.textOverlays || [],
         additionalImages: metadata.additionalImages || [],
         hasUnsavedChanges: false
       }));
     }
   }, [existingStory?.data?.id]);
   ```

2. **Загрузка изображения с оптимизацией**:
   ```typescript
   const handleImageUpload = async (file: File) => {
     // Валидация файла
     if (!file.type.startsWith('image/')) {
       setStoryData(prev => ({ 
         ...prev, 
         error: 'Можно загружать только изображения' 
       }));
       return;
     }

     if (file.size > 10 * 1024 * 1024) { // 10MB
       setStoryData(prev => ({ 
         ...prev, 
         error: 'Размер файла не должен превышать 10MB' 
       }));
       return;
     }

     setStoryData(prev => ({ ...prev, state: 'loading', error: null }));

     try {
       // 1. Optimistic update с base64 preview
       const reader = new FileReader();
       reader.onload = (e) => {
         setStoryData(prev => ({ 
           ...prev, 
           backgroundImageUrl: e.target.result as string
         }));
       };
       reader.readAsDataURL(file);

       // 2. Загрузить на Imgbb
       const formData = new FormData();
       formData.append('image', file);
       const response = await axios.post('/api/imgur/upload-file', formData);

       if (!response.data?.url) {
         throw new Error('Не получен URL от Imgbb');
       }

       const imgbbUrl = response.data.url;

       // 3. Обновить состояние с реальным URL
       setStoryData(prev => ({ 
         ...prev, 
         backgroundImageUrl: imgbbUrl,
         hasUnsavedChanges: true,
         state: 'idle',
         error: null
       }));

       // 4. Автосохранение в localStorage
       saveToLocalStorage();

     } catch (error: any) {
       setStoryData(prev => ({ 
         ...prev, 
         state: 'error',
         error: error?.message || 'Ошибка загрузки изображения'
       }));
     }
   };
   ```

3. **Сохранение Stories с валидацией**:
   ```typescript
   const handleSaveStory = async () => {
     try {
       // Валидация данных перед сохранением
       const metadata = {
         textOverlays: storyData.textOverlays,
         additionalImages: storyData.additionalImages,
         storyType: 'instagram' as const,
         format: '9:16',
         version: '1.0'
       };

       const validationResult = StoryMetadataSchema.safeParse(metadata);
       if (!validationResult.success) {
         const errors = validationResult.error.errors.reduce((acc, err) => {
           acc[err.path.join('.')] = err.message;
           return acc;
         }, {} as Record<string, string>);

         setStoryData(prev => ({ 
           ...prev, 
           validationErrors: errors,
           error: 'Исправьте ошибки валидации'
         }));
         return;
       }

       setStoryData(prev => ({ ...prev, state: 'saving', error: null }));

       // Используем пользовательский токен из headers
       await apiRequest(`/api/stories/${storyId}`, {
         method: 'PUT',
         data: { 
           title: storyData.title,
           image_url: storyData.backgroundImageUrl,
           metadata: JSON.stringify(metadata)
         }
       });

       setStoryData(prev => ({ 
         ...prev, 
         hasUnsavedChanges: false,
         state: 'idle',
         validationErrors: {}
       }));

       // Очистить localStorage после успешного сохранения
       localStorage.removeItem(`story-draft-${storyId}`);

     } catch (error: any) {
       setStoryData(prev => ({ 
         ...prev, 
         state: 'error',
         error: error?.message || 'Ошибка сохранения'
       }));
     }
   };

   // Автосохранение в localStorage
   const saveToLocalStorage = useMemo(
     () => debounce(() => {
       if (storyData.hasUnsavedChanges && storyId) {
         localStorage.setItem(`story-draft-${storyId}`, JSON.stringify({
           backgroundImageUrl: storyData.backgroundImageUrl,
           textOverlays: storyData.textOverlays,
           additionalImages: storyData.additionalImages,
           title: storyData.title,
           timestamp: Date.now()
         }));
       }
     }, 2000),
     [storyData, storyId]
   );

   // Восстановление из localStorage при загрузке
   useEffect(() => {
     if (storyId) {
       const saved = localStorage.getItem(`story-draft-${storyId}`);
       if (saved) {
         try {
           const data = JSON.parse(saved);
           // Проверяем что данные не старше 24 часов
           if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
             // Показать пользователю опцию восстановления
             // Реализовать confirm dialog
           }
         } catch (e) {
           localStorage.removeItem(`story-draft-${storyId}`);
         }
       }
     }
   }, [storyId]);
   ```

4. **Отображение с улучшенным UX**:
   ```typescript
   // Debounced URL validation
   const debouncedUrlValidation = useMemo(
     () => debounce((url: string) => {
       if (url && !isValidImageUrl(url)) {
         setStoryData(prev => ({
           ...prev,
           validationErrors: { ...prev.validationErrors, backgroundImageUrl: 'Неверный URL изображения' }
         }));
       } else {
         setStoryData(prev => ({
           ...prev,
           validationErrors: { ...prev.validationErrors, backgroundImageUrl: undefined }
         }));
       }
     }, 500),
     []
   );

   const handleUrlChange = (url: string) => {
     setStoryData(prev => ({ 
       ...prev, 
       backgroundImageUrl: url,
       hasUnsavedChanges: true 
     }));
     debouncedUrlValidation(url);
     saveToLocalStorage();
   };
   ```

   - Поле "Image URL" с валидацией в реальном времени
   - Превью с fallback состояниями (loading, error, placeholder)
   - Error states для каждого поля
   - Кнопка "Сохранить" с состояниями: disabled/loading/active
   - Toast уведомления для обратной связи

### 5. Backend обработка

#### server/routes/stories.ts - обновление PUT роута:

```typescript
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, image_url, metadata, status } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Валидация входных данных
    if (metadata) {
      try {
        const parsedMetadata = JSON.parse(metadata);
        const validationResult = StoryMetadataSchema.safeParse(parsedMetadata);
        if (!validationResult.success) {
          return res.status(400).json({ 
            error: 'Validation failed', 
            details: validationResult.error.errors 
          });
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON in metadata' });
      }
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updateData.title = title;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (status !== undefined) updateData.status = status;

    console.log('[DEV] [stories] Updating story:', id, updateData);

    // Используем пользовательский токен из запроса
    const updateResponse = await directusApi.patch(`/items/campaign_content/${id}`, updateData, {
      headers: {
        'Authorization': req.headers.authorization // Пользовательский токен
      }
    });

    const story = updateResponse.data.data;
    console.log('[DEV] [stories] Story updated successfully');

    res.json({ success: true, data: story });
  } catch (error: any) {
    console.error('Error updating story:', error?.response?.data || error?.message);

    if (error?.response?.status === 403) {
      res.status(403).json({ error: 'Access denied' });
    } else if (error?.response?.status === 404) {
      res.status(404).json({ error: 'Story not found' });
    } else {
      res.status(500).json({ error: 'Failed to update story' });
    }
  }
});
```

### 6. Пошаговый алгоритм работы

#### Загрузка существующей Story:
1. Компонент загружается с storyId
2. Делается запрос GET /api/stories/:id  
3. Фоновое изображение загружается из поля `image_url`
4. Остальные данные парсятся из поля `metadata`
5. Если `metadata` пустой - инициализируется пустая структура данных
6. Устанавливается `hasUnsavedChanges: false`

#### Загрузка нового изображения:
1. Пользователь выбирает файл через input
2. Сразу показывается base64 preview для отзывчивости
3. Файл загружается на Imgbb через /api/imgur/upload-file
4. Полученный URL обновляется ТОЛЬКО в browser state
5. Устанавливается `hasUnsavedChanges: true`
6. База данных НЕ обновляется до нажатия "Сохранить"

#### Ручное редактирование URL:
1. Пользователь вводит URL в поле "Image URL"
2. onChange обновляет состояние `backgroundImageUrl`
3. Устанавливается `hasUnsavedChanges: true`
4. База данных НЕ обновляется до нажатия "Сохранить"

#### Сохранение изменений:
1. Пользователь нажимает кнопку "Сохранить"
2. Фоновое изображение сохраняется в поле `image_url`
3. Остальные данные из browser state упаковываются в JSON
4. JSON сохраняется в поле `metadata` через PUT /api/stories/:id
5. Устанавливается `hasUnsavedChanges: false`

### 7. Тестовые сценарии

#### Базовые сценарии:
1. ✅ Создание новой Story - изначально backgroundImage = null
2. ✅ Загрузка изображения - появляется в preview и поле URL
3. ✅ Перезагрузка страницы - изображение остается видимым
4. ✅ Редактирование существующей Story - загружается из image_url
5. ✅ Ручное изменение URL - обновляется preview и сохраняется в базу

#### Краевые случаи:
1. ✅ Загрузка битого файла - показать ошибку, не ломать интерфейс
2. ✅ Ввод невалидного URL - показать ошибку, не сохранять в базу
3. ✅ Потеря интернета во время загрузки - показать ошибку
4. ✅ Несуществующий storyId - показать ошибку загрузки

### 8. UI/UX требования

#### Интерфейс должен включать:
1. **Поле загрузки файла**: `<input type="file" accept="image/*" />`
2. **Поле Image URL**: Текстовое поле для просмотра/редактирования URL
3. **Preview области**: Показывает фоновое изображение или placeholder
4. **Область текстового наложения**: Для настройки текста поверх изображения
5. **Кнопки сохранения**: "Сохранить" для сохранения всей Story

#### Состояния загрузки:
- Показывать спиннер во время загрузки на Imgbb
- Toast уведомления об успехе/ошибке
- Disabled состояние для кнопок во время операций

### 9. Критические детали реализации

#### Предотвращение проблем:
1. **Фоновое изображение ТОЛЬКО в поле image_url** - никогда не в metadata
2. **Никогда не сохранять base64 в базу данных**
3. **Всегда валидировать данные перед сохранением** - используя Zod схемы
4. **Использовать ТОЛЬКО пользовательские токены** - req.headers.authorization
5. **Обрабатывать все состояния ошибок** - 401, 403, 404, 500
6. **Автосохранение в localStorage** - для предотвращения потери данных
7. **Оптимистичные обновления** - для лучшего UX
8. **Debounced операции** - для производительности
9. **Инвалидировать React Query кэш** после успешного сохранения
10. **Детальное логирование** для отладки с уровнями ошибок

#### Логирование для отладки:
```typescript
// Структурированное логирование с уровнями
const logger = {
  info: (message: string, data?: any) => console.log(`[INFO] [Stories] ${message}`, data),
  error: (message: string, error?: any) => console.error(`[ERROR] [Stories] ${message}`, error),
  debug: (message: string, data?: any) => console.debug(`[DEBUG] [Stories] ${message}`, data)
};

// Примеры использования:
logger.info('Loading story', { storyId, userId });
logger.debug('Background image from image_url', story.image_url);
logger.info('Image uploaded to Imgbb', { imgbbUrl, fileSize: file.size });
logger.error('Failed to save story', error);
```

#### Дополнительные утилиты:
```typescript
// Валидация URL изображений
const isValidImageUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

// Debounce хук
const useDebounce = (callback: Function, delay: number) => {
  return useMemo(() => debounce(callback, delay), [callback, delay]);
};

// Error boundary компонент
const StoryEditorErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Реализация error boundary для критических ошибок
};
```

### 10. Проверка готовности

Функционал считается полностью работающим когда:
- ✅ Можно загрузить изображение и оно появляется в preview
- ✅ URL отображается в поле "Image URL"
- ✅ После перезагрузки страницы изображение остается видимым
- ✅ Можно редактировать URL вручную
- ✅ Изображение корректно сохраняется при нажатии "Сохранить Stories"
- ✅ В базе данных поле image_url содержит корректный Imgbb URL
- ✅ Никаких base64 строк в базе данных
- ✅ Никаких ошибок в консоли браузера

---

## Команда для начала реализации

Когда пользователь скажет "ДЕЛАЙ", начать реализацию от коммита `fca15b808c214dfc8afa1ecd397c4e55248b87a7` строго следуя этому техническому заданию.

Приоритет файлов для изменения:
1. `client/src/components/stories/SimpleStoryEditor.tsx` - основная логика
2. `server/routes/stories.ts` - API endpoint для обновления image_url
3. Тестирование на реальных данных

---

## Обновление: Система управления изображениями (Август 21, 2025)

### Проблема и решение
**Проблема**: Конфликты между данными в localStorage/sessionStorage и базой данных, приводящие к отображению некорректных изображений.

**Решение**: Реализована система с приоритетом базы данных и автоматической очисткой некорректных данных.

### Новая архитектура приоритетов

#### 1. Иерархия источников данных:
1. **База данных (Directus)** - главный источник истины
2. **sessionStorage** - временные пользовательские изменения  
3. **localStorage** - черновики для автовосстановления

#### 2. Ключевые принципы:
- **База данных - источник истины**: Данные из Directus всегда перезаписывают локальные данные
- **Проактивная очистка**: Автоматическое удаление некорректных данных при каждой загрузке
- **Loading состояния**: Четкие loading/idle состояния для лучшего UX
- **Детальное логирование**: Полная трассировка источников данных для отладки
- **Graceful cleanup**: Автоматическая очистка sessionStorage при выходе из редактора

#### 3. Результат обновления:
- ✅ Устранены конфликты между источниками данных
- ✅ Автоматическая очистка некорректных изображений
- ✅ Плавные переходы с loading состояниями
- ✅ Полная трассируемость источников данных
- ✅ Надежная персистентность пользовательских изменений

#### 4. Исправление новых Stories (Август 21, 2025):
**Проблема**: После загрузки изображения в новую Stories и сохранения изображение исчезало при повторном открытии.

**Решение**:
- Убрана очистка sessionStorage после сохранения (мешала отображению)
- Принудительная инвалидация кэша после автосохранения изображения
- Упрощена логика приоритетов: БД = источник истины для всех случаев
- Автоматическое сохранение изображения в БД сразу после загрузки на Imgbb

**Ключевые изменения**:
```typescript
// После загрузки на Imgbb - сразу сохраняем в БД и перезагружаем
await apiRequest(`/api/stories/simple/${actualStoryId}`, {
  method: 'PUT', 
  data: { image_url: imgbbUrl }
});
queryClient.invalidateQueries({ queryKey: ['story', actualStoryId] });

// После ручного сохранения - инвалидируем кэш для свежих данных  
queryClient.invalidateQueries({ queryKey: ['story', actualStoryId] });
```