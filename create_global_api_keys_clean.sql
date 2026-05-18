-- Создание таблицы global_api_keys с нуля с чистой структурой

-- Создаем таблицу с только нужными полями
CREATE TABLE global_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- Добавляем индексы для производительности
CREATE INDEX idx_global_api_keys_service ON global_api_keys(service_name);
CREATE INDEX idx_global_api_keys_active ON global_api_keys(is_active);

-- Добавляем комментарии для красивого отображения в Directus
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.id IS 'ID';
COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
COMMENT ON COLUMN global_api_keys.description IS 'Описание';

-- Вставляем базовые записи для основных сервисов
INSERT INTO global_api_keys (service_name, api_key, is_active, description) VALUES
('gemini', 'placeholder_key', true, 'Google Gemini API'),
('claude', 'placeholder_key', true, 'Anthropic Claude API'),
('deepseek', 'placeholder_key', true, 'DeepSeek API'),
('qwen', 'placeholder_key', true, 'Qwen API'),
('fal_ai', 'placeholder_key', true, 'FAL AI API');

-- Проверяем результат
SELECT service_name, is_active, description FROM global_api_keys ORDER BY service_name;