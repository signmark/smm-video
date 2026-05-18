# Руководство по архитектуре API

## Структура API запросов для улучшения текста

### Клиентская часть

1. В файле `client/src/lib/api.ts` определен базовый URL для всех API запросов:

```typescript
export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});
```

2. В компоненте `TextEnhancementDialog.tsx` используется метод `getApiEndpoint()`, который возвращает путь эндпоинта в зависимости от выбранной модели:

```typescript
const getApiEndpoint = () => {
  switch (selectedService) {
    case 'claude':
      return '/claude/improve-text';
    case 'deepseek':
      return '/deepseek/improve-text';
    case 'qwen':
      return '/qwen/improve-text';
    case 'gemini':
      return '/gemini/improve-text';
  }
};
```

3. При выполнении запроса, эти пути объединяются с базовым URL:

```typescript
const response = await api.post(getApiEndpoint(), {
  text,
  prompt: getCurrentPrompt(),
  model: selectedModelId,
  service: selectedService
});
```

Итоговые URL, на которые отправляются запросы:
- `/api/claude/improve-text`
- `/api/deepseek/improve-text`
- `/api/qwen/improve-text`
- `/api/gemini/improve-text`

### Серверная часть

1. В файле `server/index.ts` регистрируются маршруты для каждого сервиса:

```typescript
// Регистрируем маршруты для Claude AI
registerClaudeRoutes(app);

// Регистрируем маршруты для DeepSeek
registerDeepSeekRoutes(app);

// Регистрируем маршруты для Qwen
registerQwenRoutes(app);
```

2. Каждая функция регистрации маршрутов (например, `registerClaudeRoutes`) определяет эндпоинты, начинающиеся с `/api`:

```typescript
router.post('/api/claude/improve-text', async (req: Request, res: Response) => {
  // Обработка запроса
});
```

3. Аналогичная структура для остальных моделей:

```typescript
// DeepSeek
router.post('/api/deepseek/improve-text', async (req: Request, res: Response) => {
  // Обработка запроса
});

// Qwen
router.post('/api/qwen/improve-text', async (req: Request, res: Response) => {
  // Обработка запроса
});
```

## При добавлении новой языковой модели

1. Создайте новый файл маршрутов (например, `server/routes-gemini.ts`)
2. Определите маршрут в формате `/api/gemini/improve-text`
3. Зарегистрируйте маршруты в `server/index.ts`:

```typescript
// Импорт функции
import { registerGeminiRoutes } from './routes-gemini';

// Регистрация маршрутов
registerGeminiRoutes(app);
```

4. Убедитесь, что в клиентской части в `TextEnhancementDialog.tsx` добавлен соответствующий case для новой модели