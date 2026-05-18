-- Создание всех основных таблиц для системы
-- user_campaigns, global_api_keys, campaign_content, user_api_keys и другие

-- 1. Таблица кампаний пользователей
CREATE TABLE IF NOT EXISTS user_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    link TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trend_analysis_settings JSONB DEFAULT '{}',
    social_media_settings JSONB DEFAULT '{}'
);

-- Индексы для user_campaigns
CREATE INDEX IF NOT EXISTS idx_user_campaigns_user_id ON user_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_user_campaigns_created_at ON user_campaigns(created_at);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_campaigns_updated_at ON user_campaigns;
CREATE TRIGGER update_user_campaigns_updated_at
    BEFORE UPDATE ON user_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Комментарии для user_campaigns
COMMENT ON TABLE user_campaigns IS 'Кампании пользователей';
COMMENT ON COLUMN user_campaigns.id IS 'ID';
COMMENT ON COLUMN user_campaigns.user_id IS 'Пользователь';
COMMENT ON COLUMN user_campaigns.name IS 'Название кампании';
COMMENT ON COLUMN user_campaigns.link IS 'Ссылка';
COMMENT ON COLUMN user_campaigns.description IS 'Описание';
COMMENT ON COLUMN user_campaigns.created_at IS 'Создано';
COMMENT ON COLUMN user_campaigns.updated_at IS 'Обновлено';
COMMENT ON COLUMN user_campaigns.trend_analysis_settings IS 'Настройки анализа трендов';
COMMENT ON COLUMN user_campaigns.social_media_settings IS 'Настройки соцсетей';

-- 2. Таблица глобальных API ключей
CREATE TABLE IF NOT EXISTS global_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- Индексы для global_api_keys
CREATE INDEX IF NOT EXISTS idx_global_api_keys_service ON global_api_keys(service_name);
CREATE INDEX IF NOT EXISTS idx_global_api_keys_active ON global_api_keys(is_active);

-- Комментарии для global_api_keys
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.id IS 'ID';
COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
COMMENT ON COLUMN global_api_keys.description IS 'Описание';

-- Базовые данные для global_api_keys (если не существуют)
INSERT INTO global_api_keys (service_name, api_key, is_active, description) 
SELECT * FROM (VALUES
    ('claude', 'sk-ant-api03-82nTHlBObkxxLzBfq4Jlt1sUjaNnTbVNNDoHtvL_NkbbH7FXtWjLJ2NValUIuDHOQOsaniDDK0TrYZP6m2s4mCTgvtFJ84E9-NdGR8fhRm-Kcnh5Lrg-YTLODDhZy6AGNJyG7g5oO6Q8kBJjkECNPzJKQSh3ksYJxWdB7Nz2JwQQLTUdNQAA', true, 'Anthropic Claude API'),
    ('fal_ai', 'c3d528bb-907d-4685-b491-76f725feadb-fecf0cfbb2a5508027907a9f959a5c9', true, 'FAL AI API'),
    ('xmlriver', 'f"user":"1679","key":"179471ff631046214db712275fa3260bfda4f001")', true, 'XMLRiver API'),
    ('qwen', 'sk-7fce1ace15f4531b21bb14784574068a', true, 'Qwen API'),
    ('deepseek', 'sk-96f717066dc434af5abfbffdc7405fea8', true, 'DeepSeek API'),
    ('gemini', 'AIzaSyDaTvfWHtwi9vq3kTatny217HnbKauAvdxE', true, 'Google Gemini API'),
    ('perplexity', 'pplx-9yI5tv1813SLYVQbtHFvMDyXYBJNDKadS7A2JCyE98GSuSK', true, 'Perplexity API'),
    ('apify', 'apify_api_Jv8QYnnwWRDS23vpjAJSGND3JTXhZKzF9ky1', true, 'Apify API')
) AS t(service_name, api_key, is_active, description)
WHERE NOT EXISTS (SELECT 1 FROM global_api_keys WHERE global_api_keys.service_name = t.service_name);

-- 3. Таблица контента кампаний
CREATE TABLE IF NOT EXISTS campaign_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type VARCHAR(50) DEFAULT 'post',
    status VARCHAR(50) DEFAULT 'draft',
    platforms JSONB DEFAULT '[]',
    additional_images JSONB DEFAULT '[]',
    scheduled_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для campaign_content
CREATE INDEX IF NOT EXISTS idx_campaign_content_campaign_id ON campaign_content(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_status ON campaign_content(status);
CREATE INDEX IF NOT EXISTS idx_campaign_content_scheduled ON campaign_content(scheduled_time);

-- Комментарии для campaign_content
COMMENT ON TABLE campaign_content IS 'Контент кампаний';
COMMENT ON COLUMN campaign_content.campaign_id IS 'Кампания';
COMMENT ON COLUMN campaign_content.title IS 'Заголовок';
COMMENT ON COLUMN campaign_content.content IS 'Контент';
COMMENT ON COLUMN campaign_content.status IS 'Статус';
COMMENT ON COLUMN campaign_content.platforms IS 'Платформы';

-- 4. Таблица пользовательских API ключей
CREATE TABLE IF NOT EXISTS user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для user_api_keys
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_service ON user_api_keys(service_name);

-- Комментарии для user_api_keys
COMMENT ON TABLE user_api_keys IS 'API ключи пользователей';
COMMENT ON COLUMN user_api_keys.user_id IS 'Пользователь';
COMMENT ON COLUMN user_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN user_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN user_api_keys.is_active IS 'Активен';

-- 5. Таблица трендовых тем кампаний
CREATE TABLE IF NOT EXISTS campaign_trend_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    topic TEXT NOT NULL,
    relevance_score DECIMAL(5,2) DEFAULT 0.0,
    source VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для campaign_trend_topics
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_campaign_id ON campaign_trend_topics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_score ON campaign_trend_topics(relevance_score);

-- Комментарии для campaign_trend_topics
COMMENT ON TABLE campaign_trend_topics IS 'Трендовые темы кампаний';
COMMENT ON COLUMN campaign_trend_topics.campaign_id IS 'Кампания';
COMMENT ON COLUMN campaign_trend_topics.topic IS 'Тема';
COMMENT ON COLUMN campaign_trend_topics.relevance_score IS 'Релевантность';

-- 6a. Справочник ключевых слов
CREATE TABLE IF NOT EXISTS keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT NOT NULL UNIQUE,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6b. Таблица ключевых слов кампаний (правильная структура)
CREATE TABLE IF NOT EXISTS campaign_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    keyword UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    trend_score DECIMAL(5,2) DEFAULT 0.0,
    mentions_count INTEGER DEFAULT 0,
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для keywords
CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);

-- Индексы для campaign_keywords
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_campaign_id ON campaign_keywords(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_keyword ON campaign_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_trend_score ON campaign_keywords(trend_score);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_last_checked ON campaign_keywords(last_checked);

-- Комментарии для keywords
COMMENT ON TABLE keywords IS 'Справочник ключевых слов';
COMMENT ON COLUMN keywords.id IS 'ID';
COMMENT ON COLUMN keywords.keyword IS 'Ключевое слово';
COMMENT ON COLUMN keywords.date_created IS 'Дата создания';

-- Комментарии для campaign_keywords
COMMENT ON TABLE campaign_keywords IS 'Ключевые слова кампаний';
COMMENT ON COLUMN campaign_keywords.id IS 'ID';
COMMENT ON COLUMN campaign_keywords.campaign_id IS 'Кампания';
COMMENT ON COLUMN campaign_keywords.keyword IS 'Ключевое слово';
COMMENT ON COLUMN campaign_keywords.trend_score IS 'Оценка тренда';
COMMENT ON COLUMN campaign_keywords.mentions_count IS 'Количество упоминаний';
COMMENT ON COLUMN campaign_keywords.last_checked IS 'Последняя проверка';
COMMENT ON COLUMN campaign_keywords.date_created IS 'Дата создания';

-- Базовые ключевые слова для тестирования
INSERT INTO keywords (keyword) VALUES 
('маркетинг'),
('реклама'), 
('социальные сети'),
('контент'),
('бренд')
ON CONFLICT (keyword) DO NOTHING;

-- Триггеры для updated_at
DROP TRIGGER IF EXISTS update_campaign_content_updated_at ON campaign_content;
CREATE TRIGGER update_campaign_content_updated_at
    BEFORE UPDATE ON campaign_content
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Проверка результатов
SELECT 'user_campaigns' as table_name, COUNT(*) as records FROM user_campaigns
UNION ALL
SELECT 'global_api_keys' as table_name, COUNT(*) as records FROM global_api_keys
UNION ALL
SELECT 'campaign_content' as table_name, COUNT(*) as records FROM campaign_content
UNION ALL
SELECT 'user_api_keys' as table_name, COUNT(*) as records FROM user_api_keys
UNION ALL
SELECT 'campaign_trend_topics' as table_name, COUNT(*) as records FROM campaign_trend_topics
UNION ALL
SELECT 'campaign_keywords' as table_name, COUNT(*) as records FROM campaign_keywords;