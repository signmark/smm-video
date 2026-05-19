-- SQL запрос для экспорта ролей и разрешений из старого Directus
-- Выполнить на старом сервере (45.130.212.62) в базе directus

-- 1. Экспорт ролей
SELECT 
    'INSERT INTO directus_roles (id, name, icon, description) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(name) || ', ' ||
    quote_literal(COALESCE(icon, 'person')) || ', ' ||
    quote_literal(COALESCE(description, '')) ||
    ') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, description = EXCLUDED.description;'
FROM directus_roles
ORDER BY name;

-- 2. Экспорт разрешений
SELECT 
    'INSERT INTO directus_permissions (id, role, collection, action, permissions, validation, presets, fields) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(role) || ', ' ||
    quote_literal(collection) || ', ' ||
    quote_literal(action) || ', ' ||
    CASE WHEN permissions IS NULL THEN 'NULL' ELSE quote_literal(permissions::text) END || ', ' ||
    CASE WHEN validation IS NULL THEN 'NULL' ELSE quote_literal(validation::text) END || ', ' ||
    CASE WHEN presets IS NULL THEN 'NULL' ELSE quote_literal(presets::text) END || ', ' ||
    CASE WHEN fields IS NULL THEN 'NULL' ELSE quote_literal(fields) END ||
    ') ON CONFLICT (id) DO NOTHING;'
FROM directus_permissions
WHERE role IS NOT NULL
ORDER BY role, collection, action;

-- 3. Экспорт пользователей с их ролями
SELECT 
    'INSERT INTO directus_users (id, first_name, last_name, email, password, role, status, is_smm_admin, description, expire_date) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(COALESCE(first_name, '')) || ', ' ||
    quote_literal(COALESCE(last_name, '')) || ', ' ||
    quote_literal(email) || ', ' ||
    quote_literal(password) || ', ' ||
    CASE WHEN role IS NULL THEN 'NULL' ELSE quote_literal(role) END || ', ' ||
    quote_literal(COALESCE(status, 'active')) || ', ' ||
    COALESCE(is_smm_admin, false) || ', ' ||
    CASE WHEN description IS NULL THEN 'NULL' ELSE quote_literal(description) END || ', ' ||
    CASE WHEN expire_date IS NULL THEN 'NULL' ELSE quote_literal(expire_date::text) END ||
    ') ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, role = EXCLUDED.role, status = EXCLUDED.status, is_smm_admin = EXCLUDED.is_smm_admin, description = EXCLUDED.description, expire_date = EXCLUDED.expire_date;'
FROM directus_users
WHERE email IN ('signmark@gmail.com', 'lbrspb@gmail.com')
ORDER BY email;

-- 4. Проверочный запрос - показать структуру ролей
SELECT 
    r.name as role_name,
    r.admin_access,
    r.app_access,
    COUNT(p.id) as permissions_count
FROM directus_roles r
LEFT JOIN directus_permissions p ON r.id = p.role
GROUP BY r.id, r.name, r.admin_access, r.app_access
ORDER BY r.name;