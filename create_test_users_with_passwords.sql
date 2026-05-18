-- Создание тестовых пользователей для SMM системы
-- Выполнить в новом Directus на сервере 31.128.43.113

-- Создание роли для администратора SMM
INSERT INTO directus_roles (id, name, icon, description) 
VALUES (
    'smm-admin-role', 
    'SMM Administrator', 
    'admin_panel_settings', 
    'Администратор SMM системы с полными правами'
) ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name, 
    icon = EXCLUDED.icon, 
    description = EXCLUDED.description;

-- Создание роли для обычного пользователя
INSERT INTO directus_roles (id, name, icon, description) 
VALUES (
    'smm-user-role', 
    'SMM User', 
    'person', 
    'Обычный пользователь SMM системы'
) ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name, 
    icon = EXCLUDED.icon, 
    description = EXCLUDED.description;

-- Создание администратора: lbrspb@gmail.com
INSERT INTO directus_users (
    id, 
    first_name, 
    last_name, 
    email, 
    password, 
    role, 
    status, 
    is_smm_admin
) VALUES (
    '53921f16-f51d-4591-80b9-8caa4fde4d13', 
    'Лев', 
    'Администратор', 
    'lbrspb@gmail.com', 
    '$argon2id$v=19$m=65536,t=3,p=4$QtpZ3dh7QtpZ3dh7QtpZ3dh7$encrypted_password_hash', 
    'smm-admin-role', 
    'active', 
    true
) ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    is_smm_admin = EXCLUDED.is_smm_admin;

-- Создание обычного пользователя: signmark@gmail.com  
INSERT INTO directus_users (
    id, 
    first_name, 
    last_name, 
    email, 
    password, 
    role, 
    status, 
    is_smm_admin
) VALUES (
    'signmark-user-id-12345', 
    'Сергей', 
    'Пользователь', 
    'signmark@gmail.com', 
    '$argon2id$v=19$m=65536,t=3,p=4$password123password123$encrypted_password_hash', 
    'smm-user-role', 
    'active', 
    false
) ON CONFLICT (email) DO UPDATE SET 
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    is_smm_admin = EXCLUDED.is_smm_admin;

-- Предоставление полных разрешений для администратора
INSERT INTO directus_permissions (role, collection, action) 
SELECT 
    'smm-admin-role',
    collection_name,
    'create'
FROM (
    VALUES 
    ('campaigns'), ('campaign_content'), ('campaign_analytics'), 
    ('campaign_questionnaire'), ('global_api_keys'), ('users'),
    ('social_media_settings'), ('campaign_trends')
) AS collections(collection_name)
ON CONFLICT DO NOTHING;

INSERT INTO directus_permissions (role, collection, action) 
SELECT 
    'smm-admin-role',
    collection_name,
    'read'
FROM (
    VALUES 
    ('campaigns'), ('campaign_content'), ('campaign_analytics'), 
    ('campaign_questionnaire'), ('global_api_keys'), ('users'),
    ('social_media_settings'), ('campaign_trends')
) AS collections(collection_name)
ON CONFLICT DO NOTHING;

INSERT INTO directus_permissions (role, collection, action) 
SELECT 
    'smm-admin-role',
    collection_name,
    'update'
FROM (
    VALUES 
    ('campaigns'), ('campaign_content'), ('campaign_analytics'), 
    ('campaign_questionnaire'), ('global_api_keys'), ('users'),
    ('social_media_settings'), ('campaign_trends')
) AS collections(collection_name)
ON CONFLICT DO NOTHING;

INSERT INTO directus_permissions (role, collection, action) 
SELECT 
    'smm-admin-role',
    collection_name,
    'delete'
FROM (
    VALUES 
    ('campaigns'), ('campaign_content'), ('campaign_analytics'), 
    ('campaign_questionnaire'), ('global_api_keys'), ('users'),
    ('social_media_settings'), ('campaign_trends')
) AS collections(collection_name)
ON CONFLICT DO NOTHING;

-- Ограниченные разрешения для обычного пользователя
INSERT INTO directus_permissions (role, collection, action, permissions) 
VALUES 
    ('smm-user-role', 'campaigns', 'read', '{"user_created":{"_eq":"$CURRENT_USER"}}'),
    ('smm-user-role', 'campaigns', 'create', '{}'),
    ('smm-user-role', 'campaigns', 'update', '{"user_created":{"_eq":"$CURRENT_USER"}}'),
    ('smm-user-role', 'campaign_content', 'read', '{"user_created":{"_eq":"$CURRENT_USER"}}'),
    ('smm-user-role', 'campaign_content', 'create', '{}'),
    ('smm-user-role', 'campaign_content', 'update', '{"user_created":{"_eq":"$CURRENT_USER"}}'),
    ('smm-user-role', 'campaign_questionnaire', 'read', '{"user_created":{"_eq":"$CURRENT_USER"}}'),
    ('smm-user-role', 'campaign_questionnaire', 'create', '{}'),
    ('smm-user-role', 'campaign_questionnaire', 'update', '{"user_created":{"_eq":"$CURRENT_USER"}}')
ON CONFLICT DO NOTHING;

-- Проверка созданных пользователей
SELECT 
    u.email,
    u.first_name,
    u.last_name,
    u.is_smm_admin,
    r.name as role_name,
    u.status
FROM directus_users u
LEFT JOIN directus_roles r ON u.role = r.id
WHERE u.email IN ('signmark@gmail.com', 'lbrspb@gmail.com')
ORDER BY u.email;