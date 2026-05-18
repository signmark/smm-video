
# 🕷️ Интеграция веб-краулера с AI-агентом в SMM Manager

## 📋 Содержание
1. [Обзор системы](#обзор-системы)
2. [Архитектура веб-краулера](#архитектура-веб-краулера)
3. [AI-агент для анализа сайтов](#ai-агент-для-анализа-сайтов)
4. [Интеграция с авторизацией](#интеграция-с-авторизацией)
5. [Технические детали реализации](#технические-детали-реализации)
6. [API эндпоинты](#api-эндпоинты)
7. [Безопасность и ограничения](#безопасность-и-ограничения)
8. [Примеры использования](#примеры-использования)
9. [Расширенные возможности](#расширенные-возможности)
10. [Планы развития](#планы-развития)

---

## 🎯 Обзор системы

SMM Manager уже содержит интегрированный **веб-краулер с AI-агентом**, который автоматически анализирует сайты и извлекает полезную информацию для создания контента и бизнес-анкет. Система способна:

### 🔍 **Основные возможности**
- **Автоматический анализ веб-сайтов** - извлечение контента, структуры, метаданных
- **Обход авторизации** - поддержка логинов через формы и cookies
- **AI-анализ содержимого** - интеллектуальное извлечение ключевых данных
- **Автозаполнение анкет** - создание бизнес-профилей на основе данных сайта
- **Генерация ключевых слов** - извлечение релевантных терминов для SMM

### 🤖 **AI-возможности**
- **DeepSeek Integration** - мощный анализ текста и структуры
- **Контекстное понимание** - определение ниши, аудитории, УТП
- **Автоматическая категоризация** - классификация типа бизнеса
- **Извлечение контактов** - поиск телефонов, email, адресов
- **Анализ конкурентов** - сравнение с похожими сайтами

---

## 🕸️ Архитектура веб-краулера

### **Основные компоненты**

#### 1. **Web Crawler Agent** (`server/services/web-crawler-agent.ts`)
```typescript
export class WebCrawlerAgent {
  async analyzeSite(url: string, options: CrawlerOptions): Promise<SiteAnalysis>
  async crawlWithAuth(url: string, credentials: AuthCredentials): Promise<CrawledData>
  async extractPageContent(url: string): Promise<PageContent>
  async followLinks(baseUrl: string, maxDepth: number): Promise<LinkStructure>
}
```

#### 2. **Autonomous AI Service** (`server/services/autonomous-ai.ts`)
```typescript
export class AutonomousAI {
  async analyzeWebsiteContent(content: string): Promise<WebsiteAnalysis>
  async generateBusinessProfile(siteData: SiteData): Promise<BusinessProfile>
  async extractKeywords(content: string): Promise<string[]>
  async categorizeWebsite(data: WebsiteData): Promise<CategoryData>
}
```

#### 3. **Route Handler** (`server/routes/web-crawler-routes.ts`)
```typescript
// Основные эндпоинты
app.post('/api/crawler/analyze-site', analyzeSiteHandler)
app.post('/api/crawler/crawl-with-auth', crawlWithAuthHandler)
app.get('/api/crawler/extract-keywords/:url', extractKeywordsHandler)
app.post('/api/crawler/fill-questionnaire', fillQuestionnaireHandler)
```

### **Поток данных**
```
Пользователь вводит URL
         ↓
Web Crawler извлекает контент
         ↓
AI анализирует содержимое
         ↓
Генерируется бизнес-анкета
         ↓
Создаются ключевые слова
         ↓
Данные сохраняются в Directus
```

---

## 🧠 AI-агент для анализа сайтов

### **Функциональные возможности**

#### 1. **Анализ содержимого сайта**
```typescript
interface WebsiteAnalysis {
  businessType: string
  industry: string
  targetAudience: string[]
  uniqueSellingPoints: string[]
  products: string[]
  services: string[]
  contactInfo: ContactInfo
  socialMediaLinks: SocialLink[]
  keywords: string[]
  contentTone: 'formal' | 'casual' | 'professional' | 'friendly'
  competitorAnalysis: CompetitorData[]
}
```

#### 2. **Автоматическое заполнение бизнес-анкеты**
AI анализирует сайт и автоматически заполняет поля:
- **Название компании** - извлекается из title, заголовков
- **Описание бизнеса** - анализ About Us, главной страницы
- **Целевая аудитория** - определяется по контенту и тону
- **Продукты/услуги** - каталог, прайс-листы, описания
- **Контактная информация** - телефоны, email, адреса
- **УТП (Unique Selling Points)** - ключевые преимущества
- **Ценовая категория** - анализ прайсов и позиционирования

#### 3. **Генерация ключевых слов**
```typescript
interface KeywordAnalysis {
  primaryKeywords: string[]      // Основные термины (10-15)
  secondaryKeywords: string[]    // Дополнительные (20-30)
  longTailKeywords: string[]     // Длинные фразы (15-20)
  brandKeywords: string[]        // Брендовые запросы
  localKeywords: string[]        // Географические
  competitorKeywords: string[]   // Конкурентные
}
```

---

## 🔐 Интеграция с авторизацией

### **Поддержка различных типов авторизации**

#### 1. **Форма логина**
```typescript
interface LoginCredentials {
  username: string
  password: string
  loginUrl: string
  usernameField?: string  // default: 'username', 'email'
  passwordField?: string  // default: 'password'
  submitButton?: string   // default: 'submit'
}
```

#### 2. **Cookie-based авторизация**
```typescript
interface CookieAuth {
  cookies: Record<string, string>
  headers?: Record<string, string>
  sessionDuration?: number
}
```

#### 3. **OAuth интеграция**
```typescript
interface OAuthConfig {
  provider: 'google' | 'facebook' | 'linkedin'
  clientId: string
  redirectUri: string
  scope: string[]
}
```

### **Пример использования с авторизацией**
```typescript
// Анализ закрытого сайта с логином
const analysis = await webCrawler.crawlWithAuth('https://example.com', {
  type: 'form',
  credentials: {
    username: 'user@example.com',
    password: 'password123',
    loginUrl: 'https://example.com/login'
  },
  options: {
    maxPages: 10,
    followExternalLinks: false,
    extractImages: true,
    analyzeContent: true
  }
})
```

---

## 🛠️ Технические детали реализации

### **Используемые технологии**
- **Puppeteer/Playwright** - для браузерной автоматизации
- **Cheerio** - парсинг HTML
- **DeepSeek AI** - анализ содержимого
- **Directus API** - хранение данных
- **Node.js Streams** - обработка больших объемов данных

### **Конфигурация краулера**
```typescript
interface CrawlerConfig {
  maxPages: number              // Максимум страниц для обхода
  maxDepth: number             // Глубина обхода ссылок
  respectRobotsTxt: boolean    // Соблюдение robots.txt
  userAgent: string            // User-Agent для запросов
  delay: number                // Задержка между запросами (мс)
  timeout: number              // Таймаут запроса (мс)
  followRedirects: boolean     // Следовать переадресациям
  extractImages: boolean       // Извлекать изображения
  extractVideos: boolean       // Извлекать видео
  analyzeContent: boolean      // Включить AI-анализ
  saveRawHtml: boolean        // Сохранять HTML
}
```

### **Обработка ошибок**
```typescript
interface CrawlerError {
  type: 'network' | 'auth' | 'parsing' | 'ai' | 'storage'
  code: string
  message: string
  url?: string
  retryable: boolean
  suggestions: string[]
}
```

---

## 🌐 API эндпоинты

### **1. Анализ сайта** 
```http
POST /api/crawler/analyze-site
Content-Type: application/json

{
  "url": "https://example.com",
  "options": {
    "maxPages": 5,
    "analyzeContent": true,
    "extractKeywords": true
  }
}
```

**Ответ:**
```json
{
  "success": true,
  "analysis": {
    "businessType": "E-commerce",
    "industry": "Fashion",
    "targetAudience": ["women 25-35", "fashion enthusiasts"],
    "products": ["dresses", "accessories", "shoes"],
    "keywords": ["женская одежда", "платья", "аксессуары"],
    "contactInfo": {
      "phone": "+7 (999) 123-45-67",
      "email": "info@example.com",
      "address": "Москва, ул. Примерная, 123"
    }
  }
}
```

### **2. Краулинг с авторизацией**
```http
POST /api/crawler/crawl-with-auth
Content-Type: application/json

{
  "url": "https://private-site.com",
  "credentials": {
    "type": "form",
    "username": "user@example.com",
    "password": "password123",
    "loginUrl": "https://private-site.com/login"
  },
  "options": {
    "maxPages": 10,
    "followExternalLinks": false
  }
}
```

### **3. Автозаполнение анкеты**
```http
POST /api/crawler/fill-questionnaire
Content-Type: application/json

{
  "campaignId": "uuid-campaign-id",
  "siteUrl": "https://example.com",
  "analysisData": {
    // данные из анализа сайта
  }
}
```

### **4. Извлечение ключевых слов**
```http
GET /api/crawler/extract-keywords/https%3A%2F%2Fexample.com
```

**Ответ:**
```json
{
  "success": true,
  "keywords": {
    "primary": ["интернет-магазин", "женская одежда", "платья"],
    "secondary": ["модная одежда", "стильные аксессуары"],
    "longTail": ["купить женское платье в Москве", "модная одежда интернет магазин"],
    "brand": ["Example Fashion", "Example Store"],
    "local": ["одежда Москва", "платья в Москве"]
  }
}
```

---

## 🔒 Безопасность и ограничения

### **Меры безопасности**
1. **Rate Limiting** - ограничение количества запросов
2. **User-Agent ротация** - избежание блокировок
3. **Proxy поддержка** - обход географических ограничений
4. **Cookies изоляция** - безопасное хранение сессий
5. **Whitelist доменов** - ограничение разрешенных сайтов

### **Ограничения**
- **Максимум 100 страниц** за один запрос
- **Таймаут 60 секунд** на страницу
- **5 одновременных** краулинг-задач
- **robots.txt соблюдение** по умолчанию
- **JavaScript** - ограниченная поддержка SPA

### **Этические ограничения**
```typescript
const CRAWLING_RULES = {
  respectRobotsTxt: true,
  maxRequestRate: 1000, // мс между запросами
  excludeDomains: [
    'facebook.com', 'twitter.com', 'instagram.com'
  ],
  maxDataSize: '10MB',
  personalDataFiltering: true
}
```

---

## 💼 Примеры использования

### **1. Создание кампании для интернет-магазина**
```javascript
// 1. Пользователь вводит URL
const siteUrl = 'https://fashion-store.com'

// 2. AI анализирует сайт
const analysis = await aiAssistant.analyzeSite(siteUrl)

// 3. Создается кампания
const campaign = await createCampaign({
  name: analysis.businessName,
  description: analysis.businessDescription,
  siteUrl: siteUrl
})

// 4. Автозаполняется анкета
const questionnaire = await fillQuestionnaire(campaign.id, analysis)

// 5. Генерируются ключевые слова
const keywords = await generateKeywords(analysis.content)
```

### **2. Анализ конкурентов**
```javascript
const competitors = [
  'https://competitor1.com',
  'https://competitor2.com',
  'https://competitor3.com'
]

const competitorAnalysis = await Promise.all(
  competitors.map(url => aiAssistant.analyzeSite(url))
)

const insights = await aiAssistant.compareCompetitors(competitorAnalysis)
```

### **3. Извлечение данных из закрытого каталога**
```javascript
const catalogData = await webCrawler.crawlWithAuth('https://b2b-catalog.com', {
  type: 'form',
  credentials: {
    username: 'dealer@company.com',
    password: 'dealerpass',
    loginUrl: 'https://b2b-catalog.com/dealer-login'
  },
  options: {
    maxPages: 50,
    extractImages: true,
    extractPrices: true
  }
})

const products = await aiAssistant.extractProducts(catalogData)
```

---

## 🚀 Расширенные возможности

### **1. Мультиязычная поддержка**
```typescript
interface MultilingualCrawling {
  detectLanguage: boolean
  translateContent: boolean
  targetLanguages: string[]
  preserveOriginal: boolean
}

// Анализ многоязычного сайта
const analysis = await webCrawler.analyzeSite('https://global-company.com', {
  multilingual: {
    detectLanguage: true,
    translateContent: true,
    targetLanguages: ['ru', 'en'],
    preserveOriginal: true
  }
})
```

### **2. Структурированные данные**
```typescript
interface StructuredDataExtraction {
  extractJsonLd: boolean      // JSON-LD разметка
  extractMicrodata: boolean   // Microdata
  extractOpenGraph: boolean   // Open Graph
  extractSchemaOrg: boolean   // Schema.org
}
```

### **3. Мониторинг изменений**
```typescript
interface SiteMonitoring {
  monitorUrl: string
  checkInterval: number       // в часах
  notifyOnChanges: boolean
  trackElements: string[]     // CSS селекторы
  compareThreshold: number    // % изменений
}

// Настройка мониторинга конкурента
await webCrawler.setupMonitoring({
  monitorUrl: 'https://competitor.com/prices',
  checkInterval: 24,
  notifyOnChanges: true,
  trackElements: ['.price', '.product-name', '.availability']
})
```

### **4. Интеграция с внешними API**
```typescript
interface ExternalIntegrations {
  whoisLookup: boolean        // Информация о домене
  seoMetrics: boolean         // SEO показатели
  socialMetrics: boolean      // Социальные сигналы
  techStack: boolean          // Используемые технологии
}
```

---

## 📊 Аналитика и отчеты

### **Dashboard метрики**
- **Успешность краулинга** - % успешных запросов
- **Среднее время анализа** - производительность AI
- **Качество извлеченных данных** - точность анализа
- **Покрытие сайта** - % проанализированных страниц
- **Частота обновлений** - актуальность данных

### **Отчеты для бизнеса**
```typescript
interface CrawlingReport {
  period: DateRange
  sitesAnalyzed: number
  pagesProcessed: number
  keywordsExtracted: number
  questionnairesGenerated: number
  aiInsights: BusinessInsight[]
  competitorData: CompetitorAnalysis[]
  trendingTopics: TrendData[]
}
```

---

## 🔮 Планы развития

### **Краткосрочные цели (1-3 месяца)**
1. **Улучшение AI-анализа** - более точное определение ниш
2. **Поддержка SPA** - JavaScript-тяжелые сайты
3. **Визуальный анализ** - обработка изображений и видео
4. **API расширения** - больше настроек конфигурации

### **Среднесрочные цели (3-6 месяцев)**
1. **Machine Learning модели** - улучшение качества анализа
2. **Реальное время** - live-анализ сайтов
3. **Интеграция с CRM** - синхронизация данных
4. **Мобильная оптимизация** - анализ мобильных версий

### **Долгосрочные цели (6-12 месяцев)**
1. **Предиктивная аналитика** - прогнозирование трендов
2. **Автоматическая оптимизация** - рекомендации по улучшению
3. **Голосовые интерфейсы** - управление через AI-ассистента
4. **Blockchain интеграция** - верификация данных

---

## 🔧 Техническая настройка

### **Конфигурационные файлы**

#### Environment Variables
```env
# AI Services
DEEPSEEK_API_KEY=your_deepseek_key
OPENAI_API_KEY=your_openai_key
CLAUDE_API_KEY=your_claude_key

# Crawler Settings
CRAWLER_MAX_CONCURRENT=5
CRAWLER_DEFAULT_TIMEOUT=60000
CRAWLER_USER_AGENT="SMM-Manager-Bot/1.0"
CRAWLER_RESPECT_ROBOTS=true

# Security
CRAWLER_RATE_LIMIT=1000
CRAWLER_MAX_PAGES=100
CRAWLER_MAX_DATA_SIZE=10485760  # 10MB
```

#### Crawler Configuration
```json
{
  "crawler": {
    "defaultOptions": {
      "maxPages": 20,
      "maxDepth": 3,
      "timeout": 30000,
      "userAgent": "SMM-Manager-Bot/1.0",
      "respectRobotsTxt": true,
      "delay": 1000
    },
    "aiAnalysis": {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "temperature": 0.3,
      "maxTokens": 2000
    },
    "security": {
      "allowedDomains": ["*"],
      "blockedDomains": ["facebook.com", "twitter.com"],
      "maxRequestsPerMinute": 60,
      "requireWhitelist": false
    }
  }
}
```

### **Мониторинг и логирование**
```typescript
// Логирование всех операций краулинга
const crawlerLogger = {
  startCrawling: (url: string) => console.log(`🕷️ Starting crawl: ${url}`),
  pageProcessed: (url: string, size: number) => 
    console.log(`📄 Processed: ${url} (${size} bytes)`),
  aiAnalysisStart: (content: string) => 
    console.log(`🧠 AI analyzing ${content.length} characters`),
  errorOccurred: (error: CrawlerError) => 
    console.error(`❌ Crawler error: ${error.message}`),
  crawlingComplete: (stats: CrawlStats) => 
    console.log(`✅ Crawling complete: ${stats.pagesProcessed} pages`)
}
```

---

## 📚 Заключение

Интегрированный веб-краулер с AI-агентом в SMM Manager представляет собой мощный инструмент для автоматизации анализа сайтов и создания контент-стратегий. Система обеспечивает:

### **Ключевые преимущества:**
✅ **Автоматизация** - минимум ручной работы для анализа сайтов
✅ **Точность** - AI-анализ обеспечивает высокое качество данных  
✅ **Безопасность** - соблюдение этических норм и технических ограничений
✅ **Масштабируемость** - обработка множества сайтов одновременно
✅ **Интеграция** - seamless интеграция с существующей экосистемой SMM Manager

### **Результат для бизнеса:**
- **Экономия времени** - автоматический анализ вместо ручного исследования
- **Лучшее качество** - AI-анализ выявляет детали, которые человек может упустить  
- **Конкурентные преимущества** - быстрый анализ рынка и конкурентов
- **Персонализация** - точная настройка контент-стратегии под конкретный бизнес

Система готова к продакшн-использованию и постоянно развивается для покрытия новых сценариев использования в области социального медиа маркетинга.

---

*Документация обновлена: 26.01.2025*  
*Версия API: 2.1*  
*Совместимость: SMM Manager v3.0+*
