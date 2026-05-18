-- Упрощение таблицы global_api_keys - убираем лишние поля
-- Оставляем только основные: id, service_name, api_key, is_active, description

-- Сначала создаем новую упрощенную таблицу
CREATE TABLE global_api_keys_new (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name VARCHAR(100) NOT NULL,
    api_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    description TEXT
);

-- Копируем данные из старой таблицы
INSERT INTO global_api_keys_new (id, service_name, api_key, is_active, description)
SELECT id, service_name, api_key, is_active, description 
FROM global_api_keys;

-- Удаляем старую таблицу
DROP TABLE global_api_keys CASCADE;

-- Переименовываем новую таблицу
ALTER TABLE global_api_keys_new RENAME TO global_api_keys;

-- Добавляем индекс по service_name
CREATE UNIQUE INDEX idx_global_api_keys_service_name ON global_api_keys(service_name);

-- Добавляем комментарии
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.id IS 'ID';
COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
COMMENT ON COLUMN global_api_keys.description IS 'Описание';