-- ЭКСТРЕННАЯ ОСТАНОВКА МАССОВЫХ ПУБЛИКАЦИЙ
-- Выполнить на production сервере directus.nplanner.ru

-- 1. Обновить все контенты со статусом 'scheduled' на 'draft' для остановки публикаций
UPDATE campaign_content 
SET status = 'draft' 
WHERE status = 'scheduled';

-- 2. Сбросить все платформы со статусом 'pending' на 'not_selected' 
UPDATE campaign_content 
SET social_platforms = CASE 
    WHEN social_platforms::text LIKE '%"status":"pending"%' THEN
        REPLACE(
            REPLACE(social_platforms::text, '"status":"pending"', '"status":"not_selected"'),
            '"selected":true', '"selected":false'
        )::jsonb
    ELSE social_platforms
END
WHERE social_platforms::text LIKE '%"status":"pending"%';

-- 3. Исправить проблемные записи Facebook без postUrl
UPDATE campaign_content 
SET social_platforms = CASE 
    WHEN social_platforms::text LIKE '%"facebook"%' 
         AND social_platforms::text LIKE '%"status":"published"%' 
         AND (social_platforms::text NOT LIKE '%"postUrl"%' 
              OR social_platforms::text LIKE '%"postUrl":null%'
              OR social_platforms::text LIKE '%"postUrl":""%') THEN
        jsonb_set(
            social_platforms,
            '{facebook,status}',
            '"not_selected"'
        )
    ELSE social_platforms
END
WHERE social_platforms::text LIKE '%"facebook"%';

-- 4. Создать флаг экстренной остановки в системе
INSERT INTO directus_settings (project, key, value) 
VALUES ('default', 'emergency_stop_scheduler', 'true')
ON CONFLICT (project, key) 
DO UPDATE SET value = 'true';

-- 5. Логирование действий
INSERT INTO directus_activity (action, user, timestamp, ip, user_agent, collection, item, comment)
VALUES (
    'update',
    'system',
    NOW(),
    '127.0.0.1',
    'Emergency Stop Script',
    'system',
    'emergency_stop',
    'EMERGENCY: Mass publications stopped - all scheduled content moved to draft'
);

-- Проверочные запросы для подтверждения остановки:

-- Проверить количество контентов по статусам
SELECT status, COUNT(*) as count 
FROM campaign_content 
GROUP BY status 
ORDER BY status;

-- Проверить платформы со статусом pending
SELECT id, title, 
       social_platforms->'facebook'->>'status' as facebook_status,
       social_platforms->'telegram'->>'status' as telegram_status,
       social_platforms->'vk'->>'status' as vk_status
FROM campaign_content 
WHERE social_platforms::text LIKE '%"status":"pending"%'
LIMIT 10;

-- Проверить флаг экстренной остановки
SELECT * FROM directus_settings 
WHERE key = 'emergency_stop_scheduler';