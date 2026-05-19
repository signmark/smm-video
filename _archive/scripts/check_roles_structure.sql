-- Простая проверка структуры ролей и разрешений в старом Directus
-- Выполнить на старом сервере (45.130.212.62)

-- 1. Структура таблицы ролей
\d directus_roles;

-- 2. Просмотр всех ролей
SELECT * FROM directus_roles ORDER BY name;

-- 3. Просмотр разрешений
SELECT 
    r.name as role_name,
    p.collection,
    p.action,
    p.permissions
FROM directus_permissions p
JOIN directus_roles r ON p.role = r.id
WHERE r.name IN ('SMM Manager', 'Admin', 'Regular User')
ORDER BY r.name, p.collection, p.action;

-- 4. Пользователи с ролями
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

-- 5. Количество разрешений по ролям
SELECT 
    r.name as role_name,
    COUNT(p.id) as permissions_count
FROM directus_roles r
LEFT JOIN directus_permissions p ON r.id = p.role
GROUP BY r.id, r.name
ORDER BY permissions_count DESC;