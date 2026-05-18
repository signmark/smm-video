-- Создание таблицы global_api_keys с минимальной структурой
-- Выполните этот SQL в PostgreSQL админке

CREATE TABLE IF NOT EXISTS global_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- Добавляем индексы
CREATE INDEX IF NOT EXISTS idx_global_api_keys_service ON global_api_keys(service_name);

-- Добавляем комментарии для Directus
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
COMMENT ON COLUMN global_api_keys.description IS 'Описание';