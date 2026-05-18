-- Local database setup for offline development

-- Create users table compatible with Directus structure
CREATE TABLE IF NOT EXISTS directus_users (
    id VARCHAR PRIMARY KEY,
    email VARCHAR UNIQUE,
    first_name VARCHAR,
    last_name VARCHAR,
    password VARCHAR,
    role VARCHAR,
    status VARCHAR DEFAULT 'active',
    created_on TIMESTAMP DEFAULT NOW(),
    modified_on TIMESTAMP DEFAULT NOW()
);

-- Create sessions table for authentication
CREATE TABLE IF NOT EXISTS directus_sessions (
    token VARCHAR PRIMARY KEY,
    user_id VARCHAR,
    expires TIMESTAMP,
    ip VARCHAR,
    user_agent TEXT,
    created_on TIMESTAMP DEFAULT NOW()
);

-- Create roles table
CREATE TABLE IF NOT EXISTS directus_roles (
    id VARCHAR PRIMARY KEY,
    name VARCHAR,
    description TEXT,
    ip_access TEXT,
    enforce_tfa BOOLEAN DEFAULT false,
    admin_access BOOLEAN DEFAULT false,
    app_access BOOLEAN DEFAULT true
);

-- Create collections table
CREATE TABLE IF NOT EXISTS directus_collections (
    collection VARCHAR PRIMARY KEY,
    icon VARCHAR,
    note TEXT,
    display_template VARCHAR,
    hidden BOOLEAN DEFAULT false,
    singleton BOOLEAN DEFAULT false,
    translations JSON,
    archive_field VARCHAR,
    archive_app_filter BOOLEAN DEFAULT true,
    archive_value VARCHAR,
    unarchive_value VARCHAR,
    sort_field VARCHAR,
    accountability VARCHAR DEFAULT 'all',
    color VARCHAR,
    item_duplication_fields JSON,
    sort INTEGER,
    group_field VARCHAR,
    collapse VARCHAR DEFAULT 'open'
);

-- Insert admin user
INSERT INTO directus_users (id, email, first_name, last_name, password, role, status) 
VALUES (
    'admin-local-001',
    'admin@roboflow.tech',
    'Admin',
    'User',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password
    'admin',
    'active'
) ON CONFLICT (email) DO NOTHING;

-- Insert admin role
INSERT INTO directus_roles (id, name, description, admin_access, app_access)
VALUES (
    'admin-role-001',
    'Administrator',
    'Full system access',
    true,
    true
) ON CONFLICT (id) DO NOTHING;