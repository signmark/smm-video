-- Обновление URL Directus в настройках системы
-- Выполнить в PGAdmin после создания коллекций

-- Проверяем есть ли настройки с URL
SELECT * FROM global_api_keys WHERE service_name = 'directus_url';

-- Добавляем или обновляем URL Directus
INSERT INTO global_api_keys (service_name, api_key, is_active, description) 
VALUES ('directus_url', 'https://directus.roboflow.tech', true, 'Directus server URL')
ON CONFLICT (service_name) 
DO UPDATE SET 
    api_key = EXCLUDED.api_key,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- Проверяем результат
SELECT * FROM global_api_keys WHERE service_name = 'directus_url';

COMMIT;