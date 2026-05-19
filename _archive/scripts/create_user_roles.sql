-- Создание ролей пользователей в Directus
-- Выполнить в PGAdmin после создания коллекций

-- 1. Создание роли "SMM User" для обычных пользователей
INSERT INTO directus_roles (
    id,
    name,
    icon,
    description,
    admin_access,
    app_access
) VALUES (
    '285bde69-2f04-4f3f-989c-f7dfec3dd405',
    'SMM User',
    'person',
    'Роль для обычных пользователей SMM системы',
    false,
    true
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    icon = EXCLUDED.icon,
    description = EXCLUDED.description,
    admin_access = EXCLUDED.admin_access,
    app_access = EXCLUDED.app_access;

-- 2. Создание роли "SMM Admin" для администраторов
INSERT INTO directus_roles (
    id,
    name,
    icon,
    description,
    admin_access,
    app_access
) VALUES (
    'b985af53-8e1e-4944-92e9-a96a8fd8f37f',
    'SMM Admin',
    'admin_panel_settings',
    'Роль для SMM администраторов с расширенными правами',
    true,
    true
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    icon = EXCLUDED.icon,
    description = EXCLUDED.description,
    admin_access = EXCLUDED.admin_access,
    app_access = EXCLUDED.app_access;

-- 3. Обновление пользователей с назначением ролей
-- Обновляем signmark@gmail.com как обычного пользователя
UPDATE directus_users 
SET role = '285bde69-2f04-4f3f-989c-f7dfec3dd405'
WHERE email = 'signmark@gmail.com';

-- Обновляем lbrspb@gmail.com как SMM администратора  
UPDATE directus_users 
SET role = 'b985af53-8e1e-4944-92e9-a96a8fd8f37f'
WHERE email = 'lbrspb@gmail.com';

-- 4. Создание разрешений для роли SMM User
-- Доступ к своим кампаниям
INSERT INTO directus_permissions (
    id,
    role,
    collection,
    action,
    permissions,
    validation,
    presets,
    fields
) VALUES 
-- Доступ к user_campaigns
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_campaigns', 'create', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_campaigns', 'read', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_campaigns', 'update', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_campaigns', 'delete', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),

-- Доступ к campaign_content
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content', 'create', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content', 'read', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content', 'update', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content', 'delete', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),

-- Доступ к campaign_content_sources
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content_sources', 'create', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content_sources', 'read', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content_sources', 'update', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_content_sources', 'delete', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),

-- Доступ к business_questionnaire
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'business_questionnaire', 'create', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'business_questionnaire', 'read', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'business_questionnaire', 'update', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'business_questionnaire', 'delete', NULL, NULL, NULL, '*'),

-- Доступ к campaign_trend_topics
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_trend_topics', 'create', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_trend_topics', 'read', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_trend_topics', 'update', NULL, NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'campaign_trend_topics', 'delete', NULL, NULL, NULL, '*'),

-- Доступ к user_api_keys (только свои)
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_api_keys', 'create', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_api_keys', 'read', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_api_keys', 'update', '{"user_id":{"_eq":"$CURRENT_USER"}}', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, '*'),
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'user_api_keys', 'delete', '{"user_id":{"_eq":"$CURRENT_USER"}}', NULL, NULL, '*'),

-- Чтение global_api_keys (только чтение)
(gen_random_uuid(), '285bde69-2f04-4f3f-989c-f7dfec3dd405', 'global_api_keys', 'read', NULL, NULL, NULL, 'service_name,is_active,description')

ON CONFLICT DO NOTHING;

-- 5. Создание разрешений для роли SMM Admin (полный доступ ко всем коллекциям)
INSERT INTO directus_permissions (
    id,
    role,
    collection,
    action,
    permissions,
    validation,
    presets,
    fields
) VALUES 
-- Полный доступ ко всем коллекциям для SMM Admin
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'user_campaigns', 'create', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'user_campaigns', 'read', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'user_campaigns', 'update', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'user_campaigns', 'delete', NULL, NULL, NULL, '*'),

(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'campaign_content', 'create', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'campaign_content', 'read', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'campaign_content', 'update', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'campaign_content', 'delete', NULL, NULL, NULL, '*'),

(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'global_api_keys', 'create', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'global_api_keys', 'read', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'global_api_keys', 'update', NULL, NULL, NULL, '*'),
(gen_random_uuid(), 'b985af53-8e1e-4944-92e9-a96a8fd8f37f', 'global_api_keys', 'delete', NULL, NULL, NULL, '*')

ON CONFLICT DO NOTHING;

-- Проверка созданных ролей и пользователей
SELECT 
    r.name as role_name,
    u.first_name,
    u.last_name,
    u.email,
    u.is_smm_admin
FROM directus_users u
LEFT JOIN directus_roles r ON u.role = r.id
WHERE u.email IN ('signmark@gmail.com', 'lbrspb@gmail.com')
ORDER BY u.email;

-- Проверка разрешений
SELECT 
    r.name as role_name,
    p.collection,
    p.action,
    COUNT(*) as permissions_count
FROM directus_permissions p
JOIN directus_roles r ON p.role = r.id
WHERE r.id IN ('285bde69-2f04-4f3f-989c-f7dfec3dd405', 'b985af53-8e1e-4944-92e9-a96a8fd8f37f')
GROUP BY r.name, p.collection, p.action
ORDER BY r.name, p.collection, p.action;

COMMIT;