# Руководство по интеграции моделей генерации изображений FAL.AI

## Обзор

Данное руководство описывает процесс интеграции и добавления новых моделей генерации изображений FAL.AI в проект SMM Manager. Документ содержит информацию о структуре клиентов FAL.AI, поддерживаемых моделях и шаги для добавления новых моделей.

## Содержание

1. [Архитектура интеграции](#архитектура-интеграции)
2. [Поддерживаемые модели](#поддерживаемые-модели)
3. [Базовые типы и интерфейсы](#базовые-типы-и-интерфейсы)
4. [Добавление новой модели](#добавление-новой-модели)
5. [Обновление клиентского интерфейса](#обновление-клиентского-интерфейса)
6. [Специфичные особенности моделей](#специфичные-особенности-моделей)
7. [Отладка и диагностика](#отладка-и-диагностика)

## Архитектура интеграции

Интеграция с моделями FAL.AI реализована через два основных клиента:

1. **Официальный клиент** (`server/services/fal-ai-official-client.ts`) - использует официальную библиотеку `@fal-ai/client` для асинхронных запросов к API FAL.AI.

2. **Прямой клиент** (`server/services/fal-ai-direct-client.ts`) - реализует прямые HTTP-запросы к API FAL.AI без использования промежуточной библиотеки.

3. **Универсальный сервис** (`server/services/fal-ai-universal.ts`) - обертка, объединяющая возможности обоих клиентов и предоставляющая унифицированный интерфейс для фронтенда.

## Поддерживаемые модели

Текущая интеграция поддерживает следующие модели FAL.AI:

| Идентификатор в UI | API путь | Описание |
|--------------------|----------|----------|
| `schnell` | `fal-ai/flux/schnell` | Сверхбыстрая модель Schnell для мгновенной генерации |
| `fast-sdxl` | `fal-ai/fast-sdxl` | Быстрая версия Stable Diffusion XL |
| `sdxl` | `fal-ai/stable-diffusion/sdxl-lightning` | Стандартная модель Stable Diffusion XL Lightning |
| `fooocus` | `fal-ai/fooocus` | Модель Fooocus |
| `flux/juggernaut-xl-lightning` | `rundiffusion-fal/juggernaut-flux/lightning` | Juggernaut XL Lightning - средняя скорость/качество |
| `flux/juggernaut-xl-lora` | `rundiffusion-fal/juggernaut-flux-lora` | Juggernaut XL с LoRA - высшее качество |
| `flux/flux-lora` | `fal-ai/flux-lora` | Flux LoRA - альтернативная модель высокого качества |

## Базовые типы и интерфейсы

### Ключевой интерфейс для генерации в прямом клиенте:

```typescript
export interface DirectGenerateOptions {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_images?: number;
  model: string;
  apiKey: string;
}
```

### Ключевой интерфейс для генерации в официальном клиенте:

```typescript
export interface GenerateImageOptions {
  prompt: string;
  negative_prompt?: string;  // snake_case для соответствия API FAL.AI
  width?: number;
  height?: number;
  num_images?: number;       // snake_case для соответствия API FAL.AI
  model: string;
  token?: string;            // Опционально токен для авторизации
  
  // Поддержка camelCase для совместимости
  negativePrompt?: string;   // Алиас для negative_prompt
  numImages?: number;        // Алиас для num_images
}
```

## Добавление новой модели

Процесс добавления новой модели FAL.AI включает следующие шаги:

### 1. Обновление прямого клиента

В файле `server/services/fal-ai-direct-client.ts` добавьте обработку для новой модели в методе `generateImages`:

```typescript
// Пример добавления новой модели NewModel
} else if (options.model === 'new-model') {
  // Укажите правильный эндпоинт API для модели
  apiUrl = 'https://api.fal.ai/v1/fal-ai/new-model-path';
  
  // Определите структуру запроса в соответствии с документацией модели
  requestData = {
    // Если модель требует вложенную структуру input
    input: {
      prompt: options.prompt,
      negative_prompt: options.negative_prompt || '',
      // Другие специфичные для модели параметры
      specific_param: 'value',
      image_size: {
        width: options.width || 1024,
        height: options.height || 1024
      }
    }
  };
  
  // Если модель не требует вложенную структуру input
  // requestData = {
  //   prompt: options.prompt,
  //   negative_prompt: options.negative_prompt || '',
  //   width: options.width || 1024,
  //   height: options.height || 1024,
  //   num_images: options.num_images || 1,
  //   // Другие параметры модели
  // };
}
```

### 2. Обновление официального клиента

В файле `server/services/fal-ai-official-client.ts` добавьте новую модель в следующих местах:

#### a. Обновите маппинг моделей в методе `formatModelId`:

```typescript
private formatModelId(model: string): string {
  // Маппинг моделей на их идентификаторы для официального клиента
  const modelMap: Record<string, string> = {
    'schnell': 'fal-ai/flux/schnell',
    // ...существующие модели...
    'new-model': 'fal-ai/new-model-path', // Добавьте новую модель
  };
  
  // Остальной код метода...
}
```

#### b. Добавьте обработку параметров для новой модели в методе `prepareInputParams`:

```typescript
private prepareInputParams(options: GenerateImageOptions): any {
  // Базовые параметры...
  
  // Добавьте обработку для новой модели
  if (options.model === 'new-model' || options.model === 'fal-ai/new-model-path') {
    return {
      prompt: options.prompt,
      negative_prompt: options.negative_prompt || options.negativePrompt || '',
      // Другие специфичные параметры модели
      specific_param: 'value',
      image_size: {
        width: options.width || 1024,
        height: options.height || 1024
      },
      num_images: numImages
    };
  }
  
  // Остальные модели...
}
```

### 3. Обновление обработчика ответов

Если новая модель имеет особый формат ответа, возможно, потребуется доработать методы извлечения URL изображений:

```typescript
private extractImageUrls(result: any): string[] {
  // Существующий код...
  
  // Если новая модель возвращает URL в нестандартном формате
  if (result.custom_field && Array.isArray(result.custom_field.images)) {
    const urls = result.custom_field.images
      .filter(img => img && typeof img.url === 'string')
      .map(img => img.url);
    
    if (urls.length > 0) {
      console.log(`Извлечено ${urls.length} URL изображений из нестандартного формата`);
      return urls;
    }
  }
  
  // Остальной код извлечения URL...
}
```

## Обновление клиентского интерфейса

После добавления поддержки новой модели на сервере, необходимо обновить клиентский интерфейс:

### Обновление компонента выбора модели

В файле `client/src/components/ImageGenerationDialog.tsx` добавьте новую модель в список доступных моделей:

```tsx
// Массив доступных моделей
const modelOptions = [
  { label: "Schnell (сверхбыстрая)", value: "schnell" },
  // ...существующие модели...
  { label: "New Model (описание)", value: "new-model" }, // Добавьте новую модель
];
```

## Специфичные особенности моделей

### Schnell

Модель Schnell требует особой структуры запроса и имеет свой эндпоинт:

1. Правильный API путь: `fal-ai/flux/schnell`
2. Требуется вложенная структура `input` в запросе
3. Параметр размера изображения должен быть в формате объекта `image_size`

Пример запроса:
```json
{
  "input": {
    "prompt": "Your prompt text",
    "negative_prompt": "",
    "image_size": {
      "width": 1024,
      "height": 1024
    },
    "num_inference_steps": 4,
    "num_images": 1
  }
}
```

### Juggernaut модели

Модели семейства Juggernaut имеют следующие особенности:

1. Используют префикс `rundiffusion-fal/` в API пути
2. Параметры размера: `image_width` и `image_height` вместо `width` и `height`
3. Возвращают URL изображений в структуре `data.images[].url`

## Отладка и диагностика

### Логирование запросов

Оба клиента (прямой и официальный) включают подробное логирование запросов и ответов. Для диагностики проблем обратите внимание на:

1. Лог запроса с путем API и параметрами
2. Лог формата ответа API
3. Лог извлеченных URL изображений

### Распространенные проблемы

1. **Ошибка 401 Unauthorized**:
   - Проверьте правильность API ключа в `.env` файле
   - Убедитесь, что ключ передается в правильном формате (`Key {your-key}`)

2. **Ошибка 500 Internal Server Error**:
   - Проверьте правильность формата запроса для конкретной модели
   - Убедитесь, что используется правильный путь API

3. **Ошибка "URL изображений не найдены"**:
   - Проверьте структуру ответа от API и обновите метод извлечения URL

## Тестирование новой модели

После добавления новой модели рекомендуется:

1. Проверить генерацию с базовым промптом (например, "A serene landscape with mountains and a lake, photorealistic")
2. Протестировать обе реализации клиентов (прямой и официальный)
3. Убедиться в корректном отображении модели в интерфейсе

## Настройка параметров по умолчанию

Если новая модель должна быть установлена как модель по умолчанию, обновите соответствующие настройки в компоненте:

```tsx
// В компоненте ImageGenerationDialog.tsx
useEffect(() => {
  // Установка начальных значений
  setModelType("new-model"); // Новая модель как модель по умолчанию
  setImageSize("1024x1024");
}, []);
```