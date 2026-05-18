-- Создание пользователей для SMM системы
-- Выполнить после создания коллекций

-- Создание пользователя signmark@gmail.com
INSERT INTO directus_users (
    id,
    first_name,
    last_name,
    email,
    password,
    status,
    is_smm_admin
) VALUES (
    '2d48e263-f562-4e3f-a235-e597fd62d4d8',
    'Dmitry',
    'Zhdanov',
    'signmark@gmail.com',
    '$argon2id$v=19$m=65536,t=3,p=4$r1zeGFpdG1KEK+hkT/rpVw$1MZZyBqtkPkRpt5HKUFDoiFjij8bHXWglo8jUJJb2VA',
    'active',
    false
) ON CONFLICT (email) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    is_smm_admin = EXCLUDED.is_smm_admin;

-- Создание SMM администратора lbrspb@gmail.com
INSERT INTO directus_users (
    id,
    first_name,
    last_name,
    email,
    password,
    status,
    is_smm_admin,
    description
) VALUES (
    '53921f16-f51d-4591-80b9-8caa4fde4d13',
    'Anton',
    'Labunsky',
    'lbrspb@gmail.com',
    '$argon2id$v=19$m=65536,t=3,p=4$r1zeGFpdG1KEK+hkT/rpVw$1MZZyBqtkPkRpt5HKUFDoiFjij8bHXWglo8jUJJb2VA',
    'active',
    true,
    'Лаборатория бизнес решений'
) ON CONFLICT (email) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    is_smm_admin = EXCLUDED.is_smm_admin,
    description = EXCLUDED.description;

-- Проверка созданных пользователей
SELECT 
    id,
    first_name, 
    last_name, 
    email, 
    is_smm_admin,
    status
FROM directus_users 
WHERE email IN ('signmark@gmail.com', 'lbrspb@gmail.com');