-- Создание схемы для SMM системы в Directus (точные названия коллекций)
-- Выполнить в PGAdmin для базы directus

-- 1. user_campaigns (кампании пользователей)
CREATE TABLE user_campaigns (
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

-- 2. Таблица контента кампаний
CREATE TABLE campaign_content (
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
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES directus_users(id),
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
    links JSONB DEFAULT '[]'
);

-- 3. Таблица источников контента
CREATE TABLE content_sources (
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
    type VARCHAR(50) NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES directus_users(id),
    is_active BOOLEAN DEFAULT true,
    platform VARCHAR(50),
    followers_count INTEGER DEFAULT 0
);

-- 4. Таблица анкет бизнеса
CREATE TABLE business_questionnaire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
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

-- 5. Таблица трендовых тем кампаний
CREATE TABLE campaign_trend_topics (
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
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    reactions INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    is_bookmarked BOOLEAN DEFAULT false,
    media_links JSONB DEFAULT '[]'
);

-- 6. Таблица глобальных API ключей
CREATE TABLE global_api_keys (
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

-- 7. Таблица ключевых слов кампаний
CREATE TABLE campaign_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'draft',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Основные поля
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    keyword VARCHAR(255) NOT NULL,
    weight FLOAT DEFAULT 1.0,
    category VARCHAR(100)
);

-- 8. Добавление поля is_smm_admin к пользователям
ALTER TABLE directus_users 
ADD COLUMN IF NOT EXISTS is_smm_admin BOOLEAN DEFAULT false;

-- 9. Добавление поля expire_date к пользователям (если не существует)
ALTER TABLE directus_users 
ADD COLUMN IF NOT EXISTS expire_date TIMESTAMP WITH TIME ZONE;

-- 10. Создание индексов для оптимизации
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_campaign_id ON campaign_content(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_content_user_id ON campaign_content(user_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_campaign_id ON content_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_user_id ON content_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_business_questionnaire_campaign_id ON business_questionnaire(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_trend_topics_campaign_id ON campaign_trend_topics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_campaign_id ON campaign_keywords(campaign_id);
CREATE INDEX IF NOT EXISTS idx_global_api_keys_service_name ON global_api_keys(service_name);

-- 11. Вставка базовых API ключей (заглушки для настройки)
INSERT INTO global_api_keys (service_name, api_key, is_active, description) VALUES
('claude', 'sk-ant-api-key-placeholder', true, 'Claude API key for content generation'),
('gemini', 'google-api-key-placeholder', true, 'Google Gemini API key'),
('qwen', 'qwen-api-key-placeholder', true, 'Qwen API key'),
('deepseek', 'deepseek-api-key-placeholder', true, 'DeepSeek API key')
ON CONFLICT (service_name) DO NOTHING;

-- 12. Комментарии к таблицам
COMMENT ON TABLE campaigns IS 'Кампании пользователей для SMM';
COMMENT ON TABLE campaign_content IS 'Сгенерированный контент для кампаний';
COMMENT ON TABLE content_sources IS 'Источники контента для анализа трендов';
COMMENT ON TABLE business_questionnaire IS 'Анкеты бизнеса для персонализации контента';
COMMENT ON TABLE campaign_trend_topics IS 'Трендовые темы из различных источников';
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для внешних сервисов';
COMMENT ON TABLE campaign_keywords IS 'Ключевые слова для кампаний';

-- 13. Вставка тестовых данных
-- Создание роли для обычных пользователей (если не существует)
INSERT INTO directus_roles (id, name, icon, description)
SELECT 
    '285bde69-2f04-4f3f-989c-f7dfec3dd405',
    'SMM User',
    'person',
    'Роль для обычных пользователей SMM системы'
WHERE NOT EXISTS (SELECT 1 FROM directus_roles WHERE id = '285bde69-2f04-4f3f-989c-f7dfec3dd405');

COMMIT;