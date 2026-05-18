-- SQL для пересоздания таблицы user_campaigns с правильной структурой
-- Основано на скриншоте из Directus

DROP TABLE IF EXISTS user_campaigns CASCADE;

CREATE TABLE user_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255),
    link TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    trend_analysis_settings JSONB DEFAULT '{}',
    social_media_settings JSONB DEFAULT '{}'
);

-- Добавляем индексы для оптимизации
CREATE INDEX idx_user_campaigns_user_id ON user_campaigns(user_id);
CREATE INDEX idx_user_campaigns_created_at ON user_campaigns(created_at);

-- Комментарии к полям
COMMENT ON TABLE user_campaigns IS 'Таблица кампаний пользователей';
COMMENT ON COLUMN user_campaigns.id IS 'Уникальный идентификатор кампании';
COMMENT ON COLUMN user_campaigns.user_id IS 'ID пользователя-владельца кампании';
COMMENT ON COLUMN user_campaigns.name IS 'Название кампании';
COMMENT ON COLUMN user_campaigns.link IS 'Ссылка на сайт или ресурс кампании';
COMMENT ON COLUMN user_campaigns.description IS 'Описание кампании';
COMMENT ON COLUMN user_campaigns.created_at IS 'Дата и время создания';
COMMENT ON COLUMN user_campaigns.updated_at IS 'Дата и время последнего обновления';
COMMENT ON COLUMN user_campaigns.trend_analysis_settings IS 'Настройки анализа трендов в формате JSON';
COMMENT ON COLUMN user_campaigns.social_media_settings IS 'Настройки социальных медиа в формате JSON';