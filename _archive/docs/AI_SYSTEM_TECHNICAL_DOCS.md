# 🤖 AI Система - Техническая документация
## Автономная AI система для SMM Manager

---

## 📋 Оглавление
1. [Архитектура системы](#архитектура-системы)
2. [Основные компоненты](#основные-компоненты)
3. [AI Инструменты (Tools)](#ai-инструменты-tools)
4. [API Эндпоинты](#api-эндпоинты)
5. [Схемы данных](#схемы-данных)
6. [Автономное планирование](#автономное-планирование)
7. [Интерактивные элементы](#интерактивные-элементы)
8. [Безопасность](#безопасность)
9. [Мониторинг и логирование](#мониторинг-и-логирование)
10. [Развертывание](#развертывание)
11. [Тестирование](#тестирование)

---

## 🏗️ Архитектура системы

### Компоненты высокого уровня

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend        │    │   AI Services   │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ AIChat.tsx  │◄┼────┼─│ /api/ai-chat │ │    │ │ Gemini API  │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Interactive │ │    │ │ autonomous-  │ │    │ │ Directus    │ │
│ │ Elements    │ │    │ │ ai.ts        │ │    │ │ CMS         │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Поток данных

1. **Пользовательский ввод** → AIChat.tsx
2. **HTTP запрос** → `/api/ai-chat` 
3. **Анализ команды** → AutonomousAI.processCommand()
4. **Планирование действий** → GeminiVertexDirect
5. **Выполнение инструментов** → TOOL_IMPLEMENTATIONS
6. **Возврат результата** → Frontend

---

## 🔧 Основные компоненты

### 1. AutonomousAI Class (`server/services/autonomous-ai.ts`)

**Основной класс для обработки AI команд**

```typescript
export class AutonomousAI {
  /**
   * Обработка команды пользователя через автономную AI-систему
   */
  async processCommand(request: AIToolRequest): Promise<AIToolResponse>
  
  /**
   * Обработка полного создания кампании с выбранными опциями
   */
  private async processFullCampaignCreation(request: AIToolRequest): Promise<AIToolResponse>
  
  /**
   * Выполнение инструмента
   */
  private async executeTool(toolName: string, args: any, request: AIToolRequest): Promise<any>
}
```

### 2. AIAssistantService (`server/services/ai-assistant.ts`)

**Сервис для простых AI команд и интерактивных элементов**

```typescript
export class AIAssistantService {
  /**
   * Обработка команды пользователя
   */
  async processCommand(message: string, userId: string, campaignId: string): Promise<AIResponse>
  
  /**
   * Анализ команды и определение намерения
   */
  private analyzeCommand(message: string): Promise<CommandAnalysis>
}
```

### 3. GeminiVertexDirect (`server/services/gemini-vertex-direct.ts`)

**Интеграция с Google Gemini AI через Vertex AI**

```typescript
class GeminiVertexDirectService {
  /**
   * Генерация контента с использованием Gemini
   */
  async generateContent(prompt: string, options?: GenerationOptions): Promise<string>
  
  /**
   * Анализ текста и извлечение структурированных данных
   */
  async analyzeAndExtract(content: string, schema: any): Promise<any>
}
```

### 4. DirectusCRUD (`server/services/directus-crud.ts`)

**Универсальный CRUD интерфейс для Directus CMS**

```typescript
class DirectusCRUDService {
  async create<T>(collection: string, data: Record<string, any>): Promise<T>
  async read<T>(collection: string, id: string): Promise<T>
  async update<T>(collection: string, id: string, data: Record<string, any>): Promise<T>
  async delete(collection: string, id: string): Promise<boolean>
  async list<T>(collection: string, options: QueryOptions): Promise<T[]>
}
```

---

## 🛠️ AI Инструменты (Tools)

### Доступные инструменты (17 штук)

```typescript
const AVAILABLE_TOOLS = [
  // Управление кампаниями
  { name: "createCampaign", description: "Создать новую кампанию" },
  { name: "getCampaignData", description: "Получить данные кампании" },
  
  // SEO и ключевые слова
  { name: "getKeywordsFromWebsite", description: "Извлечь ключевые слова с сайта" },
  { name: "generateKeywords", description: "Сгенерировать ключевые слова" },
  { name: "saveKeywordsToCampaign", description: "Сохранить ключевые слова" },
  { name: "getCampaignKeywords", description: "Получить ключевые слова кампании" },
  
  // Тренды и аналитика
  { name: "collectTrends", description: "Запустить сбор трендов" },
  { name: "getTrendsData", description: "Получить собранные тренды" },
  { name: "getAnalytics", description: "Получить аналитику кампании" },
  
  // Создание контента
  { name: "createContent", description: "Создать контент для кампании" },
  { name: "getContentList", description: "Получить список контента" },
  { name: "generateHashtags", description: "Сгенерировать хештеги" },
  
  // Анкеты и данные
  { name: "readQuestionnaire", description: "Прочитать бизнес-анкету" },
  { name: "fillQuestionnaire", description: "Заполнить анкету автоматически" },
  { name: "saveData", description: "Сохранить данные в базу" },
  
  // Планирование публикаций
  { name: "startScheduler", description: "Запустить планировщик" },
  { name: "stopScheduler", description: "Остановить планировщик" },
  { name: "scheduleContent", description: "Запланировать публикацию" }
];
```

### Реализация инструментов

```typescript
const TOOL_IMPLEMENTATIONS = {
  async createCampaign(params: any, request: AIToolRequest) {
    // 1. Валидация URL (безопасность SSRF)
    // 2. Создание кампании в Directus
    // 3. Автоматическое заполнение анкеты (если указан сайт)
    // 4. Возврат ID кампании
  },
  
  async getTrendsData(params: any, request: AIToolRequest) {
    // 1. Получение трендов из коллекции 'campaign_trend_topics'
    // 2. Фильтрация по campaignId
    // 3. Сортировка по дате создания
    // 4. Возврат структурированных данных
  },
  
  async createContent(params: any, request: AIToolRequest) {
    // 1. Анализ темы и контекста кампании
    // 2. Генерация контента через Gemini
    // 3. Сохранение в коллекцию 'campaign_content'
    // 4. Возврат созданного поста
  }
  
  // ... остальные 14 инструментов
};
```

---

## 🌐 API Эндпоинты

### Основной AI чат эндпоинт

```typescript
POST /api/ai-chat
Content-Type: application/json
Authorization: Bearer <token>

{
  "message": "Создай кампанию для сайта https://example.com",
  "userId": "uuid",
  "campaignId": "uuid", // опционально
  "campaignOptions": { // для интерактивных команд
    "name": "Campaign Name",
    "websiteUrl": "https://example.com",
    "selectedOptions": {
      "websiteAnalysis": true,
      "keywords": true,
      "collectTrends": false
    }
  }
}
```

**Ответ:**
```json
{
  "response": "Кампания создана успешно",
  "success": true,
  "data": { "campaignId": "uuid" },
  "interactive": { // опционально
    "type": "campaign-options",
    "campaignOptions": {
      "name": "Campaign Name",
      "options": [...]
    }
  }
}
```

### Вспомогательные эндпоинты

```typescript
GET /api/campaign-trends?campaignId=uuid    // Получить тренды
GET /api/campaign-content?campaignId=uuid   // Получить контент
GET /api/campaigns/:id/questionnaire        // Получить анкету
POST /api/generate-content                  // Создать контент
```

---

## 🗃️ Схемы данных

### Коллекции в Directus

```typescript
// campaign_trend_topics - тренды кампании
interface CampaignTrendTopic {
  id: string;
  campaign_id: string;
  title: string;
  content: string;
  source: string;
  date_created: Date;
  engagement_score?: number;
}

// campaign_content - контент кампании
interface CampaignContent {
  id: string;
  campaign_id: string;
  title: string;
  content: string;
  hashtags?: string[];
  platforms?: string[];
  status: 'draft' | 'published' | 'scheduled';
  date_created: Date;
}

// business_questionnaires - бизнес анкеты
interface BusinessQuestionnaire {
  id: string;
  campaign_id: string;
  company_name: string;
  industry: string;
  target_audience: string;
  unique_value_proposition: string;
  // ... другие поля
  date_created: Date;
}
```

---

## 🧠 Автономное планирование

### Процесс принятия решений

1. **Анализ команды**
   - Извлечение намерения (intent)
   - Определение параметров
   - Проверка контекста пользователя

2. **Планирование действий**
   - Gemini анализирует доступные инструменты
   - Создает план выполнения (sequence of tools)
   - Определяет зависимости между инструментами

3. **Выполнение плана**
   - Последовательный вызов инструментов
   - Передача результатов между инструментами
   - Обработка ошибок и откат операций

### Пример автономного планирования

**Команда:** "Создай полную кампанию для https://shop.com"

**План Gemini:**
```json
{
  "steps": [
    { "tool": "createCampaign", "params": {"name": "Shop Campaign", "websiteUrl": "https://shop.com"} },
    { "tool": "fillQuestionnaire", "params": {"campaignId": "$CAMPAIGN_ID"} },
    { "tool": "generateKeywords", "params": {"websiteUrl": "https://shop.com", "campaignId": "$CAMPAIGN_ID"} },
    { "tool": "collectTrends", "params": {"campaignId": "$CAMPAIGN_ID"} },
    { "tool": "createContent", "params": {"campaignId": "$CAMPAIGN_ID", "count": 3} }
  ]
}
```

---

## 🎮 Интерактивные элементы

### Campaign Options Selector

```typescript
interface InteractiveMessage {
  type: 'campaign-options';
  campaignOptions: {
    name: string;
    description: string;
    websiteUrl: string;
    options: Array<{
      id: 'website-analysis' | 'keywords' | 'find-sources' | 'collect-trends' | 'content-plan';
      name: string;
      description: string;
      enabled: boolean;
    }>;
  };
}
```

### Platform Selector

```typescript
interface PlatformSelector {
  type: 'platform-selector';
  platforms: Array<{
    id: 'facebook' | 'instagram' | 'vk' | 'telegram' | 'youtube';
    name: string;
    enabled: boolean;
    icon?: string;
  }>;
}
```

### Обработка интерактивных элементов

```typescript
// Frontend (AIChat.tsx)
const CampaignOptionsSelector = ({ interactive, messageId }) => {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  
  const handleConfirm = async () => {
    // Отправка выбранных опций на сервер
    const response = await fetch('/api/ai-chat', {
      method: 'POST',
      body: JSON.stringify({
        message: `Создай полную кампанию с опциями`,
        campaignOptions: {
          selectedOptions: {
            websiteAnalysis: selectedOptions.includes('website-analysis'),
            keywords: selectedOptions.includes('keywords'),
            // ...
          }
        }
      })
    });
  };
};
```

---

## 🔒 Безопасность

### SSRF Protection

```typescript
// Валидация URL в createCampaign
if (params.websiteUrl) {
  const url = new URL(params.websiteUrl);
  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error('Недопустимый протокол URL');
  }
  
  // Блокировка приватных IP
  const hostname = url.hostname;
  if (hostname === 'localhost' || 
      hostname.startsWith('127.') || 
      hostname.startsWith('192.168.') || 
      hostname.startsWith('10.') || 
      hostname.match(/^172\\.(1[6-9]|2[0-9]|3[0-1])\\./)) {
    throw new Error('Доступ к приватным IP адресам запрещен');
  }
}
```

### Токены безопасности

```typescript
// JWT токены для авторизации
const authToken = req.headers['authorization']?.replace('Bearer ', '');

// Админский токен для критичных операций
const adminToken = await directusAuthManager.getAdminAuthToken();

// Обход ошибок 403 для системных коллекций
if (collection === 'campaign_content' || collection === 'campaign_trend_topics') {
  finalAuthToken = adminToken;
}
```

### Фильтрация данных

```typescript
// Фильтрация по пользователю
const campaigns = await directus.get('/items/campaigns', {
  filter: { user_id: { _eq: userId } }
});

// Проверка прав доступа
if (campaign.user_id !== userId && !isAdmin) {
  throw new Error('Access denied');
}
```

---

## 📊 Мониторинг и логирование

### Структурированное логирование

```typescript
console.log('[AUTONOMOUS-AI] 🚀 Processing command:', {
  userId: request.userId,
  campaignId: request.campaignId,
  command: request.message,
  timestamp: new Date().toISOString()
});

console.log('[GET-TRENDS-DATA] Получено трендов:', trends?.length || 0);

console.error('[AUTONOMOUS-AI] ❌ Tool execution error:', {
  tool: toolName,
  error: error.message,
  userId: request.userId
});
```

### Метрики для мониторинга

- **Успешность команд AI** - percentage of successful vs failed commands
- **Время ответа AI** - latency of AI command processing
- **Использование инструментов** - frequency of each tool usage
- **Ошибки по типам** - categorization of error types
- **Пользовательская активность** - commands per user/session

### Error Handling

```typescript
try {
  const result = await this.executeTool(toolName, args, request);
  return result;
} catch (error: any) {
  console.error(`[AUTONOMOUS-AI] Error executing ${toolName}:`, error);
  return { 
    error: `Ошибка выполнения ${toolName}: ${error.message}`,
    code: error.code || 'TOOL_ERROR'
  };
}
```

---

## 🚀 Развертывание

### Environment Variables

```bash
# AI Services
GOOGLE_SERVICE_ACCOUNT_KEY=<vertex-ai-credentials>
GOOGLE_PROJECT_ID=<gcp-project-id>

# Directus CMS
DIRECTUS_URL=https://directus.example.com
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=<password>

# Security
JWT_SECRET=<jwt-secret>
ALLOWED_ORIGINS=https://app.example.com
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 5000
CMD ["npm", "start"]
```

### Health Checks

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      gemini: await testGeminiConnection(),
      directus: await testDirectusConnection(),
      database: await testDatabaseConnection()
    },
    version: process.env.APP_VERSION,
    timestamp: new Date().toISOString()
  });
});
```

---

## 🧪 Тестирование

### Тестовая структура

```
server/__tests__/
├── autonomous-ai.test.ts          # Unit тесты AI системы
├── autonomous-ai-integration.test.ts # Интеграционные тесты
├── autonomous-ai-e2e.test.ts      # End-to-end тесты
└── setup.ts                       # Тестовая конфигурация
```

### Примеры тестов

```typescript
describe('Автономная AI система', () => {
  test('должен корректно выполнить инструмент createContent', async () => {
    // Мок для создания контента
    mocks.axios.post.mockResolvedValueOnce({
      data: { 
        success: true, 
        content: 'Сгенерированный контент',
        id: 'content-123'
      }
    });

    const result = await aiService.AVAILABLE_TOOLS.createContent(
      { campaignId: mockRequest.campaignId, topic: 'Тест контента' },
      mockRequest
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe('Сгенерированный контент');
  });
});
```

### Моки для тестирования

```typescript
// Контролируемые моки
const geminiMock = {
  generateContent: jest.fn()
};

jest.mock('../services/gemini-vertex-direct', () => ({
  GeminiVertexDirectService: {
    getInstance: () => geminiMock
  }
}));
```

### Запуск тестов

```bash
npm test                    # Все тесты
npm run test:unit          # Unit тесты
npm run test:integration   # Интеграционные тесты
npm run test:e2e          # End-to-end тесты
npm run test:coverage     # С покрытием кода
```

---

## 📈 Производительность

### Оптимизация AI запросов

- **Кэширование промптов** - cache common prompts and responses
- **Batch processing** - group multiple small operations
- **Async operations** - non-blocking tool execution
- **Request rate limiting** - protect against API limits

### Database Optimization

```typescript
// Оптимизированные запросы
const trends = await directusCrud.list('campaign_trend_topics', {
  filter: { campaign_id: { _eq: campaignId } },
  limit: params.limit || 10,
  sort: ['-date_created'], // Индекс по date_created
  fields: ['id', 'title', 'content', 'source', 'date_created'] // Только нужные поля
});
```

### Memory Management

```typescript
// Предотвращение утечек памяти
process.on('SIGTERM', () => {
  console.log('Graceful shutdown...');
  // Закрытие соединений
  server.close();
  process.exit(0);
});

// Ограничение memory usage
if (process.memoryUsage().heapUsed > 1024 * 1024 * 512) { // 512MB
  console.warn('High memory usage detected');
  // Очистка кэшей, GC
}
```

---

## 🔄 Maintenance

### Регулярное обслуживание

1. **Очистка логов** - rotate and archive old logs
2. **Обновление AI моделей** - update to latest Gemini versions  
3. **Оптимизация промптов** - improve AI prompt efficiency
4. **Мониторинг метрик** - review performance and error rates

### Backup Strategy

```typescript
// Автоматическое резервное копирование критичных данных
const backupCriticalData = async () => {
  const campaigns = await directus.get('/items/campaigns');
  const content = await directus.get('/items/campaign_content');
  const questionnaires = await directus.get('/items/business_questionnaires');
  
  await saveToBackupStorage({
    campaigns,
    content,
    questionnaires,
    timestamp: Date.now()
  });
};
```

---

## 📝 Заключение

Автономная AI система SMM Manager представляет собой сложную архитектуру, включающую:

- **17 специализированных инструментов** для SMM задач
- **Автономное планирование** на основе Gemini AI
- **Интерактивные элементы** для улучшения UX
- **Надежную систему безопасности** с защитой от SSRF
- **Полное тестовое покрытие** с unit, integration и e2e тестами
- **Масштабируемую архитектуру** для высоких нагрузок

Система готова к production использованию и может эффективно обрабатывать сложные SMM задачи автономно.

---

*Документация обновлена: 26.09.2025*