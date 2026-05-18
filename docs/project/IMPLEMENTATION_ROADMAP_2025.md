# План реализации функций SMM Manager

**Дата создания:** 15 декабря 2025  
**Срок:** 2 недели (до 29 декабря 2025)  
**Версия:** 2.0

---

## Содержание

1. [Обзор задач на 2 недели](#обзор-задач-на-2-недели)
2. [Неделя 1](#неделя-1)
3. [Неделя 2](#неделя-2)
4. [Отложенные задачи](#отложенные-задачи)

---

## Обзор задач на 2 недели

### Приоритетные задачи (ДЕЛАЕМ)

| # | Задача | Срок | Готовность базы |
|---|--------|------|-----------------|
| 1 | YouTube Shorts | 1 день | OAuth есть |
| 2 | VK Clips/Shorts | 1-2 дня | VK API есть |
| 3 | VK Stories | 1 день | VK API есть |
| 4 | Stories редактор (доработка) | 2-3 дня | Базовый редактор есть |
| 5 | ТГ Ассистент (диалоговый) | 3-4 дня | AI Assistant есть |
| 6 | Подбор каналов из существующей базы | 1-2 дня | 400K+ каналов уже есть |

### Отложенные задачи

| # | Задача | Причина |
|---|--------|---------|
| 1 | TikTok | Требует 1-2 недели на верификацию аккаунта |
| 2 | TGStat парсинг | API не дает список каналов, нужен отдельный парсер |

---

## Неделя 1 (16-22 декабря)

### День 1-2: YouTube Shorts + VK Clips

**YouTube Shorts** - минимальные изменения в `youtube-service.ts`:
- Добавить флаг `isShorts: boolean` в контент
- Добавить `#Shorts` в title автоматически
- UI: переключатель в редакторе контента

**VK Clips** - новый метод в `vk-service.ts`:
- Использовать `video.save` с параметром `is_clip: 1`
- Поддержка вертикального видео 9:16

### День 3-4: Stories редактор

Доработка существующего редактора (`server/routes/stories.ts`):
- Улучшить UI редактора слайдов
- Добавить экспорт в видео формат
- Предпросмотр перед публикацией

### День 5: VK Stories

Добавить метод `publishStory` в VK сервис:
- Использовать `stories.getPhotoUploadServer` / `stories.getVideoUploadServer`
- Поддержка ссылок в Stories

---

## Неделя 2 (23-29 декабря)

### День 1-4: ТГ Ассистент (диалоговое управление)

Расширение `ai-assistant.ts`:
- Добавить новые интенты для управления через чат
- Контекстные диалоги (помнит предыдущие сообщения)
- Интерактивные кнопки в Telegram

### День 5: Подбор каналов

Использовать существующую базу 400K+ каналов:
- AI-рекомендации на основе тематики кампании
- Фильтрация по категориям
- Быстрое добавление в источники кампании

---

## Детальный план по задачам

### 1. YouTube Shorts публикация

**Статус:** Частично реализовано (обычное видео работает)  
**Файлы:** `server/services/social-platforms/youtube-service.ts`

#### Что нужно сделать:

1. **Добавить определение типа контента (Shorts vs обычное видео)**
   ```typescript
   // Критерии Shorts:
   // - Вертикальное видео (9:16)
   // - Длительность <= 60 секунд
   // - В title или description есть #Shorts
   ```

2. **Модифицировать метод publishContent**
   - Добавить параметр `isShorts: boolean`
   - Для Shorts использовать специальные теги и формат
   - YouTube автоматически определяет Shorts по формату

3. **UI изменения**
   - Добавить переключатель "Публиковать как Shorts" в редакторе контента
   - Валидация: проверять длительность и ориентацию видео

#### Примерная реализация:

```typescript
// server/services/social-platforms/youtube-service.ts

interface YouTubeShortsOptions {
  isShorts: boolean;
  duration: number; // в секундах
  aspectRatio: '9:16' | '16:9' | '1:1';
}

async publishShorts(content: any, options: YouTubeShortsOptions) {
  // Валидация для Shorts
  if (options.isShorts) {
    if (options.duration > 60) {
      throw new Error('Shorts должны быть не длиннее 60 секунд');
    }
    if (options.aspectRatio !== '9:16') {
      log('youtube', 'Рекомендуется вертикальный формат 9:16 для Shorts');
    }
  }
  
  // Добавляем #Shorts в заголовок если нужно
  const title = options.isShorts && !content.title.includes('#Shorts')
    ? `${content.title} #Shorts`
    : content.title;
    
  // Публикация через YouTube Data API
  // ... существующая логика
}
```

#### Задачи:
- [ ] Добавить определение isShorts в схему контента
- [ ] Модифицировать YouTubeService.publishContent
- [ ] Добавить UI переключатель в редакторе
- [ ] Тестирование публикации Shorts

---

### 2. Добавить TikTok

**Статус:** Не реализовано  
**Сложность:** Высокая (требуется TikTok Developer Account)

#### Предварительные требования:

1. **TikTok Developer Account**
   - Регистрация на https://developers.tiktok.com/
   - Создание приложения
   - Получение Client ID и Client Secret
   - Верификация приложения (может занять 1-2 недели)

2. **TikTok API ограничения**
   - Максимальная длительность видео: 10 минут
   - Поддерживаемые форматы: MP4, WebM
   - Требуется OAuth 2.0 авторизация

#### Архитектура:

```
client/
├── src/
│   ├── components/
│   │   └── social-settings/
│   │       └── TikTokSettings.tsx        # UI настройки TikTok
│   └── pages/
│       └── oauth/
│           └── tiktok-callback.tsx       # OAuth callback
server/
├── services/
│   └── social/
│       └── tiktok-service.ts             # Новый сервис TikTok
├── routes/
│   ├── tiktok-oauth.ts                   # OAuth маршруты
│   └── tiktok-campaign-settings.ts       # Настройки кампании
└── api/
    └── tiktok-webhook.ts                 # Webhook для публикации
```

#### Основные шаги:

1. **OAuth интеграция**
```typescript
// server/routes/tiktok-oauth.ts
import express from 'express';

const router = express.Router();

// Шаг 1: Редирект на TikTok OAuth
router.get('/auth', (req, res) => {
  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?` +
    `client_key=${process.env.TIKTOK_CLIENT_KEY}` +
    `&scope=user.info.basic,video.publish,video.upload` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}` +
    `&state=${req.query.campaignId}`;
  
  res.redirect(authUrl);
});

// Шаг 2: Callback с кодом авторизации
router.get('/callback', async (req, res) => {
  const { code, state: campaignId } = req.query;
  
  // Обмен кода на access_token
  const tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI
  });
  
  // Сохранение токенов в Directus
  await saveTikTokTokens(campaignId, tokenResponse.data);
  
  res.redirect(`/campaigns/${campaignId}/settings?tiktok=connected`);
});
```

2. **Сервис публикации**
```typescript
// server/services/social/tiktok-service.ts
import axios from 'axios';
import { BaseSocialService } from './base-service';

export class TikTokService extends BaseSocialService {
  private baseUrl = 'https://open.tiktokapis.com/v2';
  
  constructor() {
    super('tiktok');
  }
  
  async publishVideo(
    content: any,
    tiktokSettings: { accessToken: string; openId: string }
  ) {
    // Шаг 1: Инициализация загрузки
    const initResponse = await axios.post(
      `${this.baseUrl}/post/publish/video/init/`,
      {
        post_info: {
          title: content.title,
          privacy_level: 'SELF_ONLY', // или PUBLIC_TO_EVERYONE
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: content.videoSize,
          chunk_size: content.videoSize,
          total_chunk_count: 1
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${tiktokSettings.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const { publish_id, upload_url } = initResponse.data.data;
    
    // Шаг 2: Загрузка видео
    await this.uploadVideoChunk(upload_url, content.videoBuffer);
    
    // Шаг 3: Подтверждение публикации
    return this.confirmPublish(publish_id, tiktokSettings.accessToken);
  }
}
```

#### Задачи:
- [ ] Зарегистрировать TikTok Developer Account
- [ ] Создать и верифицировать приложение
- [ ] Реализовать OAuth flow
- [ ] Создать TikTokService
- [ ] UI для подключения аккаунта
- [ ] Интеграция в планировщик публикаций
- [ ] Тестирование

---

### 3. VK Shorts/Клипы

**Статус:** Частично (обычные посты работают)  
**Файлы:** `server/services/social/vk-service.ts`

#### VK Clips API

VK Клипы используют отдельный API endpoint:

```typescript
// server/services/social/vk-service.ts

async publishClip(
  content: CampaignContent,
  vkSettings: { token: string; groupId: string }
) {
  const { token, groupId } = vkSettings;
  
  // Шаг 1: Получить сервер загрузки для клипов
  const uploadServerResponse = await axios.get(
    'https://api.vk.com/method/video.save', {
      params: {
        access_token: token,
        v: '5.199',
        name: content.title,
        description: content.content,
        is_private: 0,
        group_id: groupId.replace('-', ''),
        // Для клипов:
        is_clip: 1
      }
    }
  );
  
  const { upload_url, video_id } = uploadServerResponse.data.response;
  
  // Шаг 2: Загрузка видео на сервер VK
  const formData = new FormData();
  formData.append('video_file', await this.getVideoBuffer(content.videoUrl));
  
  await axios.post(upload_url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  
  // Шаг 3: Опубликовать клип
  const publishResponse = await axios.get(
    'https://api.vk.com/method/video.publish', {
      params: {
        access_token: token,
        v: '5.199',
        video_id,
        owner_id: `-${groupId.replace('-', '')}`
      }
    }
  );
  
  return {
    platform: 'vk',
    status: 'published',
    postUrl: `https://vk.com/clip${groupId}_${video_id}`,
    publishedAt: new Date()
  };
}
```

#### Особенности VK Клипов:
- Вертикальное видео (9:16)
- Длительность до 3 минут
- Автоматическое добавление в раздел "Клипы"
- Требует параметр `is_clip: 1` при загрузке

#### Задачи:
- [ ] Добавить метод publishClip в VkService
- [ ] Добавить определение типа контента (обычное видео vs клип)
- [ ] UI переключатель "Публиковать как Клип"
- [ ] Интеграция в планировщик
- [ ] Тестирование

---

### 4. Редактор Stories (доработка)

**Статус:** Базовая версия существует  
**Файлы:** 
- `server/routes/stories.ts`
- `client/src/components/stories/`

#### Текущие возможности:
- Создание и редактирование слайдов
- Текст, градиенты
- Экспорт 1080x1920
- Сохранение в Directus

#### Что нужно доработать:

1. **Улучшение редактора**
   - Добавление стикеров и элементов
   - Анимации переходов между слайдами
   - Таймер показа каждого слайда
   - Добавление музыки/аудио

2. **Генерация видео из слайдов**
```typescript
// server/routes/stories.ts

router.post('/:id/render-video', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { slides, duration = 5 } = req.body; // duration в секундах на слайд
  
  // Используем существующий realVideoConverter
  const videoPath = await realVideoConverter.createStoryVideo({
    slides,
    slideDuration: duration,
    outputFormat: 'mp4',
    resolution: { width: 1080, height: 1920 }
  });
  
  // Загружаем на Beget S3
  const videoUrl = await begetS3.upload(videoPath, 'stories');
  
  res.json({ success: true, videoUrl });
});
```

3. **Предпросмотр перед публикацией**
   - Анимированный превью всех слайдов
   - Проверка на соответствие требованиям платформ

#### Задачи:
- [ ] Добавить стикеры и элементы в редактор
- [ ] Реализовать таймер слайдов
- [ ] Создать конвертер слайдов в видео
- [ ] Добавить превью перед публикацией
- [ ] Интеграция с публикацией в Instagram Stories

---

### 5. Stories в VK

**Статус:** Не реализовано  
**Зависимости:** После Stories редактора

#### VK Stories API:

```typescript
// server/services/social/vk-service.ts

async publishStory(
  storyContent: {
    type: 'photo' | 'video';
    mediaUrl: string;
    link?: { text: string; url: string };
  },
  vkSettings: { token: string; groupId?: string }
) {
  const { token, groupId } = vkSettings;
  
  // Получение сервера загрузки
  const uploadServerResponse = await axios.get(
    'https://api.vk.com/method/stories.getPhotoUploadServer', {
      params: {
        access_token: token,
        v: '5.199',
        add_to_news: 1,
        group_id: groupId ? groupId.replace('-', '') : undefined,
        link_text: storyContent.link?.text,
        link_url: storyContent.link?.url
      }
    }
  );
  
  const { upload_url } = uploadServerResponse.data.response;
  
  // Загрузка медиа
  const formData = new FormData();
  const mediaBuffer = await this.downloadMedia(storyContent.mediaUrl);
  formData.append('photo', mediaBuffer, 'story.jpg');
  
  const uploadResponse = await axios.post(upload_url, formData);
  const { upload_result } = uploadResponse.data;
  
  // Сохранение истории
  const saveResponse = await axios.get(
    'https://api.vk.com/method/stories.save', {
      params: {
        access_token: token,
        v: '5.199',
        upload_results: upload_result
      }
    }
  );
  
  return {
    platform: 'vk',
    type: 'story',
    status: 'published',
    storyId: saveResponse.data.response.items[0].id
  };
}
```

#### Задачи:
- [ ] Добавить метод publishStory в VkService
- [ ] Поддержка фото и видео Stories
- [ ] Добавление ссылок в Stories (VK поддерживает)
- [ ] UI для выбора публикации как Story
- [ ] Тестирование

---

### 6. ТГ Ассистент (диалоговое управление SMM)

**Статус:** Базовая версия существует  
**Файлы:**
- `server/services/ai-assistant.ts` (3875 строк)
- `server/services/autonomous-ai.ts`
- `server/telegram-bot/index.ts`

#### Текущие возможности:
- Function Calling через Gemini
- Автономный режим AI
- Базовые команды через бота

#### Что нужно доработать:

1. **Расширение возможностей Natural Language**

```typescript
// Дополнительные интенты для AI Assistant
export interface ExtendedCommandAnalysis {
  intent: 
    // Существующие
    | 'create_posts' | 'schedule_posts' | 'publish_content' 
    // Новые для полного управления
    | 'view_scheduled'           // "Покажи запланированные посты"
    | 'edit_post'                // "Измени пост про..."
    | 'delete_post'              // "Удали последний пост"
    | 'connect_platform'         // "Подключи Instagram"
    | 'view_analytics'           // "Какая статистика за неделю?"
    | 'suggest_content'          // "Что постить сегодня?"
    | 'optimize_time'            // "Когда лучше публиковать?"
    | 'respond_comments'         // "Ответь на комментарии"
    | 'create_story'             // "Создай сторис про..."
    | 'bulk_schedule'            // "Запланируй на неделю"
    | 'switch_campaign'          // "Переключись на кампанию X"
    | 'campaign_status';         // "Статус кампании"
}
```

2. **Контекстное управление диалогом**

```typescript
// server/services/ai-conversation-manager.ts

export class AIConversationManager {
  private conversationContext: Map<string, ConversationContext> = new Map();
  
  interface ConversationContext {
    userId: string;
    activeCampaignId: string;
    lastAction: string;
    pendingConfirmation?: {
      action: string;
      data: any;
    };
    recentTopics: string[];
  }
  
  async processMessage(userId: string, message: string): Promise<AIResponse> {
    const context = this.getOrCreateContext(userId);
    
    // Понимание контекстных ссылок
    // "Опубликуй это" -> использует последний созданный контент
    // "Туда же" -> использует последнюю платформу
    // "Завтра в то же время" -> использует время из контекста
    
    const resolvedMessage = this.resolveContextualReferences(message, context);
    
    // Обработка через AI
    const response = await this.aiAssistant.processCommand({
      message: resolvedMessage,
      userId,
      campaignId: context.activeCampaignId,
      chatHistory: this.getChatHistory(userId)
    });
    
    // Обновление контекста
    this.updateContext(userId, response);
    
    return response;
  }
}
```

3. **Интеграция с Telegram Bot**

```typescript
// server/telegram-bot/handlers/natural-language-handler.ts

export class NaturalLanguageHandler {
  constructor(
    private aiAssistant: AIAssistantService,
    private conversationManager: AIConversationManager
  ) {}
  
  async handleMessage(ctx: Context) {
    const userId = await this.getUserIdFromTelegram(ctx.from.id);
    const message = ctx.message.text;
    
    // Показываем "печатает..."
    await ctx.sendChatAction('typing');
    
    // Обрабатываем через AI
    const response = await this.conversationManager.processMessage(userId, message);
    
    // Форматируем ответ для Telegram
    if (response.interactive) {
      // Отправляем интерактивные кнопки
      await this.sendInteractiveResponse(ctx, response);
    } else {
      // Обычный текстовый ответ
      await ctx.reply(response.response, { parse_mode: 'HTML' });
    }
    
    // Если есть действие, выполняем его
    if (response.action) {
      await this.executeAction(ctx, response.action, response.data);
    }
  }
  
  private async sendInteractiveResponse(ctx: Context, response: AIResponse) {
    // Inline кнопки для действий
    const keyboard = Markup.inlineKeyboard(
      response.interactive.options.map(opt => 
        Markup.button.callback(opt.name, `action:${opt.id}`)
      )
    );
    
    await ctx.reply(response.response, keyboard);
  }
}
```

4. **Примеры диалогов**

```
Пользователь: Привет! Что у меня на сегодня?
Бот: 👋 Добрый день! Вот ваш план на сегодня:
     📅 3 поста запланированы:
     • 10:00 - Telegram: "Новинки недели..."
     • 14:00 - Instagram: "За кулисами..."  
     • 18:00 - VK: "Вечерний дайджест..."
     
     Хотите изменить время или отредактировать какой-то пост?

Пользователь: Перенеси пост про новинки на 11:00
Бот: ✅ Готово! Пост "Новинки недели" перенесен с 10:00 на 11:00.
     Напомнить вам за 30 минут до публикации?

Пользователь: Да, и создай еще один пост на вечер про скидки
Бот: 📝 Создаю пост про скидки. Уточните:
     • На какое время? (по умолчанию 20:00)
     • Какие соцсети? [Telegram] [Instagram] [VK] [Все]
     • С картинкой или без?
```

#### Задачи:
- [ ] Расширить список интентов в AI Assistant
- [ ] Создать ConversationManager для контекстных диалогов
- [ ] Интегрировать NaturalLanguageHandler в Telegram Bot
- [ ] Добавить интерактивные кнопки в ответы
- [ ] Реализовать подтверждение действий
- [ ] Тестирование различных сценариев

---

### 7. База каналов TGStat

**Статус:** Не реализовано  
**Существующая база:** 400,000+ каналов уже собрано

#### Варианты получения данных:

1. **TGStat API** (платный)
   - Официальный API с полными данными
   - Стоимость: от $99/месяц
   - Актуальные метрики в реальном времени

2. **Парсинг публичных данных**
   - Бесплатно
   - Требует обхода защиты
   - Данные могут устаревать

#### Рекомендуемый подход - гибридный:

```typescript
// server/services/tgstat-service.ts

export class TGStatService {
  private cache: Map<string, ChannelData> = new Map();
  
  async getChannelsByCategory(category: string, options: {
    minSubscribers?: number;
    maxSubscribers?: number;
    language?: 'ru' | 'en' | 'any';
    sortBy?: 'subscribers' | 'engagement' | 'growth';
  }) {
    // Сначала проверяем локальную базу
    const localChannels = await this.searchLocalDatabase(category, options);
    
    if (localChannels.length >= options.limit) {
      return localChannels;
    }
    
    // Если нужно больше - запрашиваем TGStat API
    if (process.env.TGSTAT_API_KEY) {
      const apiChannels = await this.fetchFromTGStatAPI(category, options);
      await this.cacheChannels(apiChannels);
      return [...localChannels, ...apiChannels];
    }
    
    return localChannels;
  }
  
  private async fetchFromTGStatAPI(category: string, options: any) {
    const response = await axios.get('https://api.tgstat.ru/channels/search', {
      params: {
        token: process.env.TGSTAT_API_KEY,
        q: category,
        country: options.language === 'ru' ? 'ru' : undefined,
        participants_count_from: options.minSubscribers,
        participants_count_to: options.maxSubscribers,
        sort: options.sortBy || 'participants_count'
      }
    });
    
    return response.data.response.items;
  }
}
```

#### Задачи:
- [ ] Оценить необходимость TGStat API (платный vs парсинг)
- [ ] Создать TGStatService
- [ ] Интегрировать с существующей базой каналов
- [ ] Добавить фильтрацию по категориям и метрикам
- [ ] UI для поиска и добавления каналов

---

### 8. Подбор каналов по теме

**Статус:** Частично (поиск каналов есть)  
**Зависимости:** База TGStat

#### Улучшение поиска:

```typescript
// server/services/channel-recommender.ts

export class ChannelRecommenderService {
  constructor(
    private tgStatService: TGStatService,
    private geminiService: GeminiService
  ) {}
  
  async recommendChannelsForCampaign(campaignId: string) {
    // Получаем данные кампании
    const campaign = await this.getCampaign(campaignId);
    
    // Анализируем ключевые слова и тематику через AI
    const analysis = await this.geminiService.analyze(`
      Проанализируй бизнес и определи:
      1. Основные темы для мониторинга
      2. Ключевые слова для поиска каналов
      3. Рекомендуемые категории каналов
      
      Данные бизнеса:
      ${JSON.stringify(campaign.questionnaire)}
    `);
    
    // Поиск каналов по рекомендациям AI
    const channels = await Promise.all(
      analysis.categories.map(cat => 
        this.tgStatService.getChannelsByCategory(cat, {
          minSubscribers: 1000,
          language: 'ru',
          sortBy: 'engagement'
        })
      )
    );
    
    // Ранжирование релевантности через AI
    const rankedChannels = await this.rankByRelevance(
      channels.flat(), 
      campaign
    );
    
    return rankedChannels.slice(0, 20); // Топ-20 рекомендаций
  }
  
  async addChannelsToCampaign(campaignId: string, channelIds: string[]) {
    // Добавление каналов в источники кампании
    const campaign = await this.getCampaign(campaignId);
    const existingSources = campaign.sources || [];
    
    const newSources = channelIds.map(id => ({
      type: 'telegram',
      channelId: id,
      addedAt: new Date()
    }));
    
    await this.updateCampaign(campaignId, {
      sources: [...existingSources, ...newSources]
    });
    
    return { added: newSources.length };
  }
}
```

#### Задачи:
- [ ] Создать ChannelRecommenderService
- [ ] Интеграция с AI для анализа тематики
- [ ] UI для просмотра и добавления рекомендаций
- [ ] Автоматическое обновление рекомендаций

---

## Техническая архитектура

### Обновленная структура файлов

```
server/
├── services/
│   ├── social/
│   │   ├── base-service.ts
│   │   ├── telegram-service.ts
│   │   ├── instagram-service.ts
│   │   ├── facebook.ts
│   │   ├── vk-service.ts           # + publishClip, publishStory
│   │   └── index.ts
│   ├── social-platforms/
│   │   ├── youtube-service.ts      # + publishShorts
│   │   └── tiktok-service.ts       # НОВЫЙ
│   ├── ai-assistant.ts             # Расширенные интенты
│   ├── ai-conversation-manager.ts  # НОВЫЙ
│   ├── tgstat-service.ts           # НОВЫЙ
│   └── channel-recommender.ts      # НОВЫЙ
├── routes/
│   ├── tiktok-oauth.ts             # НОВЫЙ
│   ├── tiktok-campaign-settings.ts # НОВЫЙ
│   └── stories.ts                  # Расширение
└── telegram-bot/
    └── handlers/
        └── natural-language-handler.ts # НОВЫЙ

client/
├── src/
│   ├── components/
│   │   ├── social-settings/
│   │   │   └── TikTokSettings.tsx  # НОВЫЙ
│   │   └── stories/
│   │       └── EnhancedStoryEditor.tsx # Доработка
│   └── pages/
│       └── channels/
│           └── recommendations.tsx  # НОВЫЙ
```

### Переменные окружения (новые)

```env
# TikTok
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret
TIKTOK_REDIRECT_URI=https://your-domain.com/api/tiktok/callback

# TGStat (опционально)
TGSTAT_API_KEY=your_api_key

# YouTube (существующие)
YOUTUBE_CLIENT_ID=existing
YOUTUBE_CLIENT_SECRET=existing
YOUTUBE_REDIRECT_URI=existing
```

---

## Отложенные задачи (после 29 декабря)

### TikTok интеграция
- Требует регистрации на https://developers.tiktok.com/
- Верификация приложения занимает 1-2 недели
- После верификации: 3-5 дней на реализацию

### Дополнительный сбор каналов TGStat
- TGStat API не дает список каналов (только аналитику по ID)
- Варианты: парсинг tgstat.ru или использование telemetr.me
- Отдельная задача на будущее

---

## Чеклист готовности

### Готово к работе:
- [x] YouTube OAuth настроен
- [x] VK API интегрирован  
- [x] AI Assistant работает (Gemini + Function Calling)
- [x] База 400K+ каналов собрана
- [x] Stories редактор (базовая версия)

### Нужно проверить:
- [ ] VK API документация для Clips и Stories
- [ ] Работа YouTube Shorts через Data API v3
- [ ] Тестовые аккаунты для публикации

---

## Трекер выполнения

| Задача | Статус | Дата |
|--------|--------|------|
| YouTube Shorts | ⏳ Ожидает | - |
| VK Clips | ⏳ Ожидает | - |
| Stories редактор | ⏳ Ожидает | - |
| VK Stories | ⏳ Ожидает | - |
| ТГ Ассистент | ⏳ Ожидает | - |
| Подбор каналов | ⏳ Ожидает | - |

---

*Обновлено: 15 декабря 2025*
