-- =======================================
-- Скрипты для обслуживания базы данных
-- =======================================

-- =======================================
-- 1. ПОИСК И УДАЛЕНИЕ ПОСТОВ БЕЗ SOCIAL_PLATFORMS
-- =======================================

-- Найти все посты без social_platforms или с пустым social_platforms
SELECT id, title, scheduled_at 
FROM campaign_content
WHERE social_platforms IS NULL 
   OR social_platforms = '{}'::jsonb;

-- Удаление постов без social_platforms
-- ВНИМАНИЕ: Этот запрос удаляет данные! Сначала выполните SELECT, чтобы проверить, какие записи будут удалены
DELETE FROM campaign_content
WHERE id IN (
  SELECT id 
  FROM campaign_content
  WHERE social_platforms IS NULL 
     OR social_platforms = '{}'::jsonb
);

-- =======================================
-- 2. ПОИСК И УДАЛЕНИЕ ДУБЛИКАТОВ
-- =======================================

-- Найти дубликаты постов на одну и ту же дату
WITH grouped_posts AS (
  SELECT 
    id, 
    title, 
    scheduled_at, 
    created_at,
    ROW_NUMBER() OVER (PARTITION BY DATE(scheduled_at) ORDER BY created_at) as row_num
  FROM campaign_content
  WHERE scheduled_at IS NOT NULL
    AND campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e'
)
SELECT id, title, scheduled_at
FROM grouped_posts
WHERE row_num > 1;

-- Удаление дубликатов на одну дату (кроме самого старого поста)
-- ВНИМАНИЕ: Этот запрос удаляет данные!
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
      AND campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e'
  )
  SELECT id
  FROM grouped_posts
  WHERE row_num > 1
);

-- =======================================
-- 3. ПРОВЕРКА КОЛИЧЕСТВА ПОСТОВ
-- =======================================

-- Общее количество постов для данной кампании
SELECT COUNT(*) FROM campaign_content WHERE campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e';

-- Количество постов без social_platforms
SELECT COUNT(*) FROM campaign_content 
WHERE (social_platforms IS NULL OR social_platforms = '{}'::jsonb)
AND campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e';

-- Количество дубликатов
WITH grouped_posts AS (
  SELECT 
    id, 
    scheduled_at,
    ROW_NUMBER() OVER (PARTITION BY DATE(scheduled_at) ORDER BY created_at) as row_num
  FROM campaign_content
  WHERE scheduled_at IS NOT NULL
    AND campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e'
)
SELECT COUNT(*) 
FROM grouped_posts
WHERE row_num > 1;

-- =======================================
-- 4. РЕЗЕРВНОЕ КОПИРОВАНИЕ И ВОССТАНОВЛЕНИЕ
-- =======================================

-- Создание резервной копии таблицы
CREATE TABLE campaign_content_backup AS 
SELECT * FROM campaign_content 
WHERE campaign_id = '46868c44-c6a4-4bed-accf-9ad07bba790e';

-- Восстановление из резервной копии
INSERT INTO campaign_content 
SELECT * FROM campaign_content_backup;

-- Удаление резервной копии
DROP TABLE campaign_content_backup;

-- =======================================
-- 5. СОЗДАНИЕ ТАБЛИЦ ПРОЕКТА
-- =======================================

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

-- Создание таблицы ключевых слов кампании
CREATE TABLE IF NOT EXISTS campaign_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES user_campaigns(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  trend_score VARCHAR(20) DEFAULT '0',
  mentions_count INT DEFAULT 0,
  last_checked TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создание уникального индекса для проверки дубликатов ключевых слов с учетом регистра
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_keywords_unique_keyword 
ON campaign_keywords(campaign_id, LOWER(keyword));

-- Создание триггерной функции для проверки уникальности ключевых слов
CREATE OR REPLACE FUNCTION check_keyword_uniqueness()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campaign_keywords 
    WHERE campaign_id = NEW.campaign_id 
    AND LOWER(keyword) = LOWER(NEW.keyword)
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Дубликат ключевого слова: "%". Такое ключевое слово уже существует в данной кампании.', NEW.keyword;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Создание триггера для проверки уникальности ключевых слов
DROP TRIGGER IF EXISTS check_keyword_uniqueness_trigger ON campaign_keywords;
CREATE TRIGGER check_keyword_uniqueness_trigger
BEFORE INSERT OR UPDATE ON campaign_keywords
FOR EACH ROW
EXECUTE FUNCTION check_keyword_uniqueness();

-- =======================================
-- 6. ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ ЗАПРОСОВ
-- =======================================

-- Индекс для запросов по дате публикации
CREATE INDEX IF NOT EXISTS idx_campaign_content_scheduled_at 
ON campaign_content(scheduled_at);

-- Индекс для запросов по кампании и статусу
CREATE INDEX IF NOT EXISTS idx_campaign_content_campaign_status 
ON campaign_content(campaign_id, status);

-- Индекс для запросов по пользователю
CREATE INDEX IF NOT EXISTS idx_campaign_content_user_id 
ON campaign_content(user_id);

-- Индекс для запросов по кампании в трендовых темах
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_campaign_id 
ON campaign_trend_topics(campaign_id);

-- Индекс для эффективного поиска закладок
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_is_bookmarked 
ON campaign_trend_topics(is_bookmarked);