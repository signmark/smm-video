# SMM Manager - Платформа управления контентом в социальных сетях

SMM Manager - это интеллектуальная платформа управления контентом в социальных сетях, которая помогает создателям с помощью генерации контента на основе ИИ, аналитики и стратегий публикации на нескольких платформах.

## Общее описание

Приложение предоставляет адаптивные рабочие процессы для создания контента с интеллектуальным планированием, созданием контента на нескольких языках с помощью ИИ и возможностями прямой публикации в социальных сетях. Используя передовые технологии искусственного интеллекта и надежные интеграции API, платформа обеспечивает плавное, эффективное и творческое управление социальными медиа.

## Стек технологий

- **Фронтенд**: React с TypeScript
- **Бэкенд**: PostgreSQL с Directus
- **Управление состоянием**: React Query
- **Аутентификация**: Пользовательский middleware для обновления токенов
- **Интеграция с ИИ**: DeepSeek, Perplexity API, FAL AI Proxy
- **Локализация**: Генерация контента на нескольких языках
- **Публикация в социальных сетях**: Расширенное получение и развертывание запланированного контента

## Системные требования

- Node.js 20.x или выше
- PostgreSQL 14.x или выше
- Directus 10.x или выше
- Доступ к API-ключам для используемых сервисов ИИ (DeepSeek, Perplexity, FAL AI)

## Быстрый старт

### 1. Клонирование репозитория

```bash
git clone https://github.com/yourusername/smm-manager.git
cd smm-manager
```

### 2. Установка зависимостей

```bash
npm install
```

### 3. Настройка переменных окружения

Создайте файл `.env` на основе `.env.sample`:

```
# База данных
DATABASE_URL=postgres://username:password@localhost:5432/dbname

# Directus
DIRECTUS_URL=https://your-directus-url.com
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=your-admin-password
DIRECTUS_ADMIN_TOKEN=your-admin-token

# API ключи для сервисов ИИ
PERPLEXITY_API_KEY=your-perplexity-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
FAL_AI_API_KEY=your-fal-ai-api-key

# Настройки социальных сетей
VK_TOKEN=your-vk-token
VK_GROUP_ID=your-vk-group-id
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
```

### 4. Запуск приложения

```bash
npm run dev
```

После запуска приложение будет доступно по адресу http://localhost:5000

## Развертывание с нуля

### 1. Настройка Directus

1. Установите и запустите Directus согласно [официальной документации](https://docs.directus.io/self-hosted/quickstart.html)
2. Создайте базу данных PostgreSQL для приложения

### 2. Создание таблиц базы данных

Используйте SQL-запросы из файла `db-maintenance.sql` для создания необходимых таблиц:

```sql
-- Создание таблицы кампаний пользователей
CREATE TABLE IF NOT EXISTS user_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  user_id UUID NOT NULL,
  trend_analysis_settings JSONB DEFAULT '{}',
  social_media_settings JSONB DEFAULT '{}'
);

-- Создание таблицы контента кампаний
CREATE TABLE IF NOT EXISTS campaign_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  image_url TEXT,
  keywords TEXT[],
  status VARCHAR(50) DEFAULT 'draft',
  campaign_id UUID NOT NULL REFERENCES user_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  social_platforms JSONB DEFAULT '{}',
  visibility VARCHAR(50) DEFAULT 'published'
);

-- Создание таблицы источников контента
CREATE TABLE IF NOT EXISTS content_sources (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  platform VARCHAR(50),
  followers_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  user_id UUID NOT NULL,
  campaign_id UUID REFERENCES user_campaigns(id) ON DELETE CASCADE
);

-- Создание таблицы трендовых тем
CREATE TABLE IF NOT EXISTS trend_topics (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_id INTEGER REFERENCES content_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  trend_score FLOAT DEFAULT 0,
  mentions_count INTEGER DEFAULT 0,
  campaign_id INTEGER REFERENCES user_campaigns(id) ON DELETE CASCADE
);

-- Создание таблицы трендовых тем кампаний
CREATE TABLE IF NOT EXISTS campaign_trend_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_post JSONB,
  source_url TEXT,
  source_platform VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  trend_score FLOAT DEFAULT 0,
  mentions_count INTEGER DEFAULT 0,
  is_bookmarked BOOLEAN DEFAULT FALSE,
  campaign_id UUID REFERENCES user_campaigns(id) ON DELETE CASCADE
);

-- Создание таблицы бизнес-опросника
CREATE TABLE IF NOT EXISTS business_questionnaire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID UNIQUE REFERENCES user_campaigns(id) ON DELETE CASCADE,
  business_name VARCHAR(255),
  business_description TEXT,
  business_goals TEXT[],
  target_audience JSONB DEFAULT '{}',
  competitors TEXT[],
  keywords TEXT[],
  tone_of_voice TEXT,
  content_preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_campaign_content_scheduled_at 
ON campaign_content(scheduled_at);

CREATE INDEX IF NOT EXISTS idx_campaign_content_campaign_status 
ON campaign_content(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_content_user_id 
ON campaign_content(user_id);

CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_campaign_id 
ON campaign_trend_topics(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_is_bookmarked 
ON campaign_trend_topics(is_bookmarked);
```

### 3. Настройка Directus для работы с таблицами

В административной панели Directus:

1. Перейдите в раздел "Settings" -> "Data Model"
2. Убедитесь, что все таблицы появились в списке коллекций
3. Для каждой таблицы настройте права доступа в разделе "Settings" -> "Roles & Permissions"

### 4. Первоначальная настройка ролей и прав доступа

Для обеспечения безопасности, настройте роли в Directus:

```sql
-- Создание роли "Editor" для пользователей
INSERT INTO directus_roles (id, name, admin_access, app_access)
VALUES (
  gen_random_uuid(),
  'Editor',
  false,
  true
);

-- Получение ID только что созданной роли
WITH editor_role AS (
  SELECT id FROM directus_roles WHERE name = 'Editor' LIMIT 1
)
-- Установка прав доступа для роли Editor
INSERT INTO directus_permissions (role, collection, action, fields)
VALUES
  ((SELECT id FROM editor_role), 'user_campaigns', 'create', '*'),
  ((SELECT id FROM editor_role), 'user_campaigns', 'read', '*'),
  ((SELECT id FROM editor_role), 'user_campaigns', 'update', '*'),
  ((SELECT id FROM editor_role), 'user_campaigns', 'delete', '*'),
  ((SELECT id FROM editor_role), 'campaign_content', 'create', '*'),
  ((SELECT id FROM editor_role), 'campaign_content', 'read', '*'),
  ((SELECT id FROM editor_role), 'campaign_content', 'update', '*'),
  ((SELECT id FROM editor_role), 'campaign_content', 'delete', '*'),
  ((SELECT id FROM editor_role), 'content_sources', 'create', '*'),
  ((SELECT id FROM editor_role), 'content_sources', 'read', '*'),
  ((SELECT id FROM editor_role), 'content_sources', 'update', '*'),
  ((SELECT id FROM editor_role), 'content_sources', 'delete', '*'),
  ((SELECT id FROM editor_role), 'campaign_trend_topics', 'create', '*'),
  ((SELECT id FROM editor_role), 'campaign_trend_topics', 'read', '*'),
  ((SELECT id FROM editor_role), 'campaign_trend_topics', 'update', '*'),
  ((SELECT id FROM editor_role), 'business_questionnaire', 'create', '*'),
  ((SELECT id FROM editor_role), 'business_questionnaire', 'read', '*'),
  ((SELECT id FROM editor_role), 'business_questionnaire', 'update', '*');
```

### 5. Обслуживание и очистка базы данных

Для очистки базы данных от дубликатов и записей без social_platforms используйте следующие SQL-запросы:

```sql
-- Найти и удалить посты без social_platforms
DELETE FROM campaign_content
WHERE id IN (
  SELECT id 
  FROM campaign_content
  WHERE social_platforms IS NULL 
     OR social_platforms = '{}'::jsonb
);

-- Удаление дубликатов на одну дату (кроме самого старого поста)
DELETE FROM campaign_content
WHERE id IN (
  WITH grouped_posts AS (
    SELECT 
      id, 
      scheduled_at, 
      created_at,
      ROW_NUMBER() OVER (PARTITION BY DATE(scheduled_at) ORDER BY created_at) as row_num
    FROM campaign_content
    WHERE scheduled_at IS NOT NULL
      AND campaign_id = 'ваш_id_кампании'
  )
  SELECT id
  FROM grouped_posts
  WHERE row_num > 1
);
```

Подробные SQL-запросы для обслуживания базы данных находятся в файле `db-maintenance.sql`.

## Функциональные возможности

- **Управление кампаниями**: Создание и управление маркетинговыми кампаниями для различных брендов
- **Генерация контента с использованием ИИ**: Автоматическое создание текстов, изображений для различных социальных платформ
- **Планирование публикаций**: Календарь для планирования и отслеживания контента
- **Мультиплатформенная публикация**: Одновременная публикация во ВКонтакте, Telegram и других платформах
- **Анализ трендов**: Отслеживание популярных тем и контента в выбранной нише
- **Персонализация контента**: Адаптация контента под разные платформы и аудитории

## Обслуживание приложения

### Обновление системы

```bash
git pull
npm install
npm run db:push # Применение изменений в схеме базы данных
```

### Запуск в производственной среде

```bash
npm run build
npm start
```

### Мониторинг и логирование

Логи приложения сохраняются в директории `logs/`. Для анализа логов рекомендуется использовать стандартные инструменты Linux:

```bash
tail -f logs/app.log
grep "ERROR" logs/app.log
```

## Архитектура приложения

- **`client/`** - Фронтенд приложения на React и TypeScript
- **`server/`** - Бэкенд-сервер Express, обрабатывающий API запросы
- **`shared/`** - Общие типы и схемы, используемые как фронтендом, так и бэкендом
- **`scripts/`** - Утилиты и скрипты для обслуживания приложения
- **`migrations/`** - Миграции базы данных
- **`test_scripts/`** - Тестовые скрипты для различных компонентов:
  - `telegram/` - Тесты интеграции с Telegram
  - `instagram/` - Тесты интеграции с Instagram
  - `facebook/` - Тесты интеграции с Facebook
  - `beget_s3/` - Тесты хранилища Beget S3
  - `fal_ai/` - Тесты интеграции с FAL.AI моделями
  - `html/` - Тесты форматирования HTML
  - `api/` - Тесты API интеграций
  - `utils/` - Утилиты для запуска тестов
- **`docs/`** - Документация проекта, разделенная по категориям:
  - `api/` - Документация по API архитектуре и интеграциям
  - `ai/` - Интеграция с AI моделями
  - `social_media/` - Интеграции с социальными сетями
  - `storage/` - Хранение данных и S3 интеграции
  - `deployment/` - Инструкции по развертыванию
  - `technical/` - Технические документы и решения
  - `project/` - Проектные документы
  - `testing/` - Тестирование компонентов
- **`implementation_docs/`** - Детальная документация по реализации компонентов

## Лицензия

Все права защищены. Этот проект является частной собственностью и не предназначен для распространения без разрешения владельца.