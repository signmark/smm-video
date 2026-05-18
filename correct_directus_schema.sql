-- Создание точных коллекций из скриншота для SMM системы
-- Выполнить в PGAdmin для базы directus

-- 1. business_questionnaire
CREATE TABLE IF NOT EXISTS business_questionnaire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    campaign_id UUID,
    company_name VARCHAR(255),
    contact_info TEXT,
    business_description TEXT,
    target_audience TEXT,
    business_goals TEXT,
    unique_selling_proposition TEXT,
    competitor_analysis TEXT,
    brand_voice TEXT,
    content_preferences TEXT,
    budget_range VARCHAR(100),
    timeline VARCHAR(100),
    success_metrics TEXT,
    additional_notes TEXT
);

-- 2. campaign_content
CREATE TABLE IF NOT EXISTS campaign_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    title VARCHAR(255),
    content TEXT,
    campaign_id UUID,
    user_id UUID REFERENCES directus_users(id),
    content_type VARCHAR(50) DEFAULT 'text',
    image_url TEXT,
    video_url TEXT,
    keywords JSONB DEFAULT '[]',
    hashtags JSONB DEFAULT '[]',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    social_platforms JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    prompt TEXT,
    links JSONB DEFAULT '[]',
    visibility VARCHAR(50) DEFAULT 'published'
);

-- 3. campaign_content_sources
CREATE TABLE IF NOT EXISTS campaign_content_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    platform VARCHAR(50),
    followers_count INTEGER DEFAULT 0,
    campaign_id UUID,
    user_id UUID REFERENCES directus_users(id),
    is_active BOOLEAN DEFAULT true
);

-- 4. campaign_keywords
CREATE TABLE IF NOT EXISTS campaign_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    campaign_id UUID,
    keyword VARCHAR(255) NOT NULL,
    weight FLOAT DEFAULT 1.0,
    category VARCHAR(100)
);

-- 5. campaign_trend_topics
CREATE TABLE IF NOT EXISTS campaign_trend_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    title VARCHAR(255) NOT NULL,
    source_id VARCHAR(255),
    campaign_id UUID,
    reactions INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    is_bookmarked BOOLEAN DEFAULT false,
    media_links JSONB DEFAULT '[]'
);

-- 6. global_api_keys
CREATE TABLE IF NOT EXISTS global_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    service_name VARCHAR(255) NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- 7. post_comment
CREATE TABLE IF NOT EXISTS post_comment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    post_id UUID,
    user_id UUID REFERENCES directus_users(id),
    comment_text TEXT,
    parent_comment_id UUID REFERENCES post_comment(id)
);

-- 8. source_posts
CREATE TABLE IF NOT EXISTS source_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    source_id UUID,
    title VARCHAR(255),
    content TEXT,
    original_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    engagement_metrics JSONB DEFAULT '{}',
    media_urls JSONB DEFAULT '[]'
);

-- 9. user_api_keys
CREATE TABLE IF NOT EXISTS user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    user_id UUID NOT NULL REFERENCES directus_users(id),
    service_name VARCHAR(255) NOT NULL,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- 10. user_campaigns
CREATE TABLE IF NOT EXISTS user_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    title VARCHAR(255) NOT NULL,
    description TEXT,
    link TEXT,
    user_id UUID NOT NULL REFERENCES directus_users(id),
    social_media_settings JSONB DEFAULT '{}',
    trend_analysis_settings JSONB DEFAULT '{}'
);

-- 11. user_keywords_user_campaigns (связующая таблица many-to-many)
CREATE TABLE IF NOT EXISTS user_keywords_user_campaigns (
    id SERIAL PRIMARY KEY,
    user_keywords_id UUID,
    user_campaigns_id UUID REFERENCES user_campaigns(id) ON DELETE CASCADE
);

-- Добавление поля is_smm_admin к пользователям (если не существует)
ALTER TABLE directus_users 
ADD COLUMN IF NOT EXISTS is_smm_admin BOOLEAN DEFAULT false;

-- Добавление поля expire_date к пользователям (если не существует)
ALTER TABLE directus_users 
ADD COLUMN IF NOT EXISTS expire_date TIMESTAMP WITH TIME ZONE;

-- Создание внешних ключей для связей
ALTER TABLE business_questionnaire 
ADD CONSTRAINT fk_business_questionnaire_campaign 
FOREIGN KEY (campaign_id) REFERENCES user_campaigns(id) ON DELETE CASCADE;

ALTER TABLE campaign_content 
ADD CONSTRAINT fk_campaign_content_campaign 
FOREIGN KEY (campaign_id) REFERENCES user_campaigns(id) ON DELETE CASCADE;

ALTER TABLE campaign_content_sources 
ADD CONSTRAINT fk_campaign_content_sources_campaign 
FOREIGN KEY (campaign_id) REFERENCES user_campaigns(id) ON DELETE CASCADE;

ALTER TABLE campaign_keywords 
ADD CONSTRAINT fk_campaign_keywords_campaign 
FOREIGN KEY (campaign_id) REFERENCES user_campaigns(id) ON DELETE CASCADE;

ALTER TABLE campaign_trend_topics 
ADD CONSTRAINT fk_campaign_trend_topics_campaign 
FOREIGN KEY (campaign_id) REFERENCES user_campaigns(id) ON DELETE CASCADE;

-- Создание индексов для оптимизации
CREATE INDEX IF NOT EXISTS idx_user_campaigns_user_id ON user_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_campaign_id ON campaign_content(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_user_id ON campaign_content(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_sources_campaign_id ON campaign_content_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_campaign_id ON campaign_keywords(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_campaign_id ON campaign_trend_topics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_source_posts_source_id ON source_posts(source_id);
CREATE INDEX IF NOT EXISTS idx_post_comment_post_id ON post_comment(post_id);

-- Вставка базовых API ключей
INSERT INTO global_api_keys (service_name, api_key, is_active, description) VALUES
('claude', 'sk-ant-api-key-placeholder', true, 'Claude API key for content generation'),
('gemini', 'google-api-key-placeholder', true, 'Google Gemini API key'),
('qwen', 'qwen-api-key-placeholder', true, 'Qwen API key'),
('deepseek', 'deepseek-api-key-placeholder', true, 'DeepSeek API key')
ON CONFLICT (service_name) DO NOTHING;

COMMIT;