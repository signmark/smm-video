-- Создание пользователей в Directus
-- Выполнить после создания схемы

-- 1. Пользователь signmark@gmail.com
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
    gen_random_uuid(),
    'Dmitry',
    'Zhdanov',
    'signmark@gmail.com',
    '$argon2id$v=19$m=65536,t=3,p=4$r1zeGFpdG1KEK+hkT/rpVw$1MZZyBqtkPkRpt5HKUFDoiFjij8bHXWglo8jUJJb2VA', -- password123
    '285bde69-2f04-4f3f-989c-f7dfec3dd405',
    'active',
    false
);

-- 2. SMM Администратор lbrspb@gmail.com
INSERT INTO directus_users (
    id,
    first_name,
    last_name,
    email,
    password,
    role,
    status,
    is_smm_admin,
    description
) VALUES (
    gen_random_uuid(),
    'Anton',
    'Labunsky',
    'lbrspb@gmail.com',
    '$argon2id$v=19$m=65536,t=3,p=4$r1zeGFpdG1KEK+hkT/rpVw$1MZZyBqtkPkRpt5HKUFDoiFjij8bHXWglo8jUJJb2VA', -- password123
    '285bde69-2f04-4f3f-989c-f7dfec3dd405',
    'active',
    true,
    'Лаборатория бизнес решений'
);

COMMIT;