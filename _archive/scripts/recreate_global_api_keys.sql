-- Полное пересоздание таблицы global_api_keys с чистой структурой

-- 1. Сохраняем данные во временную таблицу
CREATE TEMP TABLE temp_api_keys AS 
SELECT service_name, api_key, is_active, description 
FROM global_api_keys;

-- 2. Удаляем старую таблицу
DROP TABLE IF EXISTS global_api_keys CASCADE;

-- 3. Создаем новую таблицу с чистой структурой
CREATE TABLE global_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- 4. Восстанавливаем данные
INSERT INTO global_api_keys (service_name, api_key, is_active, description)
SELECT service_name, api_key, 
       COALESCE(is_active, true) as is_active, 
       description 
FROM temp_api_keys;

-- 5. Добавляем индексы
CREATE INDEX idx_global_api_keys_service ON global_api_keys(service_name);
CREATE INDEX idx_global_api_keys_active ON global_api_keys(is_active);

-- 6. Добавляем комментарии для красивого отображения в Directus
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.id IS 'ID';
COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
COMMENT ON COLUMN global_api_keys.description IS 'Описание';

-- 7. Проверяем результат
SELECT COUNT(*) as total_keys FROM global_api_keys;