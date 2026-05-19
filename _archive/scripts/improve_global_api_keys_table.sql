-- Улучшение структуры таблицы global_api_keys для лучшего отображения в Directus

-- Добавляем комментарии к полям для красивого отображения
COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
COMMENT ON COLUMN global_api_keys.id IS 'Уникальный идентификатор';
COMMENT ON COLUMN global_api_keys.service_name IS 'Название сервиса (gemini, claude, openai, deepseek и т.д.)';
COMMENT ON COLUMN global_api_keys.api_key IS 'API ключ для доступа к сервису';
COMMENT ON COLUMN global_api_keys.is_active IS 'Статус активности (включен/выключен)';
COMMENT ON COLUMN global_api_keys.description IS 'Описание назначения и особенностей ключа';
COMMENT ON COLUMN global_api_keys.created_at IS 'Дата создания';
COMMENT ON COLUMN global_api_keys.updated_at IS 'Дата последнего изменения';

-- Убеждаемся что поле description достаточно длинное для подробных описаний
ALTER TABLE global_api_keys 
ALTER COLUMN description TYPE TEXT;