-- Instagram Credentials Table Schema
-- Таблица для хранения учетных данных Instagram Business API

CREATE TABLE IF NOT EXISTS instagram_credentials (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES directus_users(id) ON DELETE CASCADE,
    
    -- Facebook App данные
    app_id VARCHAR(255) NOT NULL,
    app_secret TEXT NOT NULL, -- Зашифровано в продакшене
    
    -- OAuth токены
    user_access_token TEXT NOT NULL,
    token_expires_in INTEGER,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    token_refreshed_at TIMESTAMP WITH TIME ZONE,
    
    -- Facebook пользователь
    facebook_user JSONB,
    
    -- Instagram аккаунты (массив)
    instagram_accounts JSONB DEFAULT '[]'::jsonb,
    
    -- Webhook настройки
    webhook_url VARCHAR(500),
    
    -- Статус подключения
    status VARCHAR(50) DEFAULT 'active',
    setup_completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Временные метки
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Индексы
    UNIQUE(user_id),
    INDEX idx_instagram_credentials_user_id (user_id),
    INDEX idx_instagram_credentials_status (status)
);

-- Комментарии к полям
COMMENT ON TABLE instagram_credentials IS 'Учетные данные Instagram Business API для пользователей';
COMMENT ON COLUMN instagram_credentials.user_id IS 'ID пользователя в Directus';
COMMENT ON COLUMN instagram_credentials.app_id IS 'Facebook App ID';
COMMENT ON COLUMN instagram_credentials.app_secret IS 'Facebook App Secret (зашифрован)';
COMMENT ON COLUMN instagram_credentials.user_access_token IS 'Долгосрочный токен пользователя Facebook';
COMMENT ON COLUMN instagram_credentials.facebook_user IS 'Данные пользователя Facebook (JSON)';
COMMENT ON COLUMN instagram_credentials.instagram_accounts IS 'Массив подключенных Instagram Business аккаунтов (JSON)';
COMMENT ON COLUMN instagram_credentials.webhook_url IS 'URL для уведомлений о публикациях';
COMMENT ON COLUMN instagram_credentials.status IS 'Статус подключения: active, expired, disabled';

-- Пример структуры данных:
/*
facebook_user: {
  "id": "12345678901234567",
  "name": "John Doe", 
  "email": "john@example.com"
}

instagram_accounts: [
  {
    "instagramId": "17841400455970028",
    "username": "my_business",
    "name": "My Business",
    "profilePicture": "https://scontent.cdninstagram.com/...",
    "pageId": "987654321098765",
    "pageName": "My Business Page",
    "pageAccessToken": "EAA..."
  }
]
*/