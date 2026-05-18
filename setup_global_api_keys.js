/**
 * Скрипт для автоматической настройки таблицы Global API Keys
 * Создает таблицу в базе данных и настраивает интерфейс в Directus
 */

import axios from 'axios';
import pkg from 'pg';
const { Client } = pkg;

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

// Подключение к PostgreSQL
const dbConfig = {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: false
};

async function executeSQL() {
    console.log('=== Создание таблицы Global API Keys ===\n');
    
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Подключение к базе данных успешно');
        
        // SQL для создания таблицы
        const createTableSQL = `
            -- Создание таблицы global_api_keys с чистой структурой
            CREATE TABLE IF NOT EXISTS global_api_keys (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                service_name VARCHAR(100) NOT NULL UNIQUE,
                api_key TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                description TEXT
            );

            -- Добавляем индексы
            CREATE INDEX IF NOT EXISTS idx_global_api_keys_service ON global_api_keys(service_name);
            CREATE INDEX IF NOT EXISTS idx_global_api_keys_active ON global_api_keys(is_active);

            -- Добавляем комментарии
            COMMENT ON TABLE global_api_keys IS 'Глобальные API ключи для AI сервисов';
            COMMENT ON COLUMN global_api_keys.id IS 'ID';
            COMMENT ON COLUMN global_api_keys.service_name IS 'Сервис';
            COMMENT ON COLUMN global_api_keys.api_key IS 'API Ключ';
            COMMENT ON COLUMN global_api_keys.is_active IS 'Активен';
            COMMENT ON COLUMN global_api_keys.description IS 'Описание';

            -- Вставляем базовые записи (только если таблица пустая)
            INSERT INTO global_api_keys (service_name, api_key, is_active, description) 
            SELECT * FROM (VALUES
                ('gemini', 'your_gemini_key_here', true, 'Google Gemini API'),
                ('claude', 'your_claude_key_here', true, 'Anthropic Claude API'),
                ('deepseek', 'your_deepseek_key_here', true, 'DeepSeek API'),
                ('qwen', 'your_qwen_key_here', true, 'Qwen API'),
                ('fal_ai', 'your_fal_ai_key_here', true, 'FAL AI API')
            ) AS t(service_name, api_key, is_active, description)
            WHERE NOT EXISTS (SELECT 1 FROM global_api_keys WHERE global_api_keys.service_name = t.service_name);
        `;
        
        await client.query(createTableSQL);
        console.log('✅ Таблица global_api_keys создана');
        
        // Проверяем результат
        const result = await client.query('SELECT service_name, is_active, description FROM global_api_keys ORDER BY service_name');
        console.log(`✅ Добавлено ${result.rows.length} записей:`);
        result.rows.forEach(row => {
            console.log(`   - ${row.service_name}: ${row.description} (${row.is_active ? 'активен' : 'неактивен'})`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка при создании таблицы:', error.message);
        throw error;
    } finally {
        await client.end();
    }
}

async function authenticate() {
    console.log('\n=== Авторизация в Directus ===\n');
    
    try {
        const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        
        console.log('✅ Авторизация успешна');
        return response.data.data.access_token;
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.response?.data || error.message);
        throw error;
    }
}

async function refreshSchema(token) {
    console.log('\n=== Обновление схемы Directus ===\n');
    
    try {
        // Обновляем схему
        await axios.post(`${DIRECTUS_URL}/schema/snapshot`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log('✅ Схема Directus обновлена');
        
        // Проверяем коллекцию
        const collectionsResponse = await axios.get(`${DIRECTUS_URL}/collections`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        const globalApiKeysCollection = collectionsResponse.data.data.find(c => c.collection === 'global_api_keys');
        if (globalApiKeysCollection) {
            console.log('✅ Коллекция global_api_keys найдена в Directus');
        } else {
            console.log('⚠️  Коллекция global_api_keys не найдена, но это нормально');
        }
        
    } catch (error) {
        console.error('❌ Ошибка обновления схемы:', error.response?.data || error.message);
        throw error;
    }
}

async function setupInterface(token) {
    console.log('\n=== Настройка интерфейса ===\n');
    
    try {
        // Настройка отображения полей
        const fieldsConfig = [
            {
                field: 'service_name',
                interface: 'input',
                options: { placeholder: 'Название сервиса' },
                display: 'raw',
                readonly: false,
                hidden: false,
                sort: 1,
                width: 'half'
            },
            {
                field: 'api_key',
                interface: 'input-hash',
                options: { placeholder: 'API ключ', masked: true },
                display: 'raw',
                readonly: false,
                hidden: false,
                sort: 2,
                width: 'full'
            },
            {
                field: 'is_active',
                interface: 'boolean',
                options: {},
                display: 'boolean',
                readonly: false,
                hidden: false,
                sort: 3,
                width: 'half'
            },
            {
                field: 'description',
                interface: 'input',
                options: { placeholder: 'Описание сервиса' },
                display: 'raw',
                readonly: false,
                hidden: false,
                sort: 4,
                width: 'full'
            }
        ];
        
        // Обновляем поля
        for (const fieldConfig of fieldsConfig) {
            try {
                await axios.patch(`${DIRECTUS_URL}/fields/global_api_keys/${fieldConfig.field}`, fieldConfig, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log(`✅ Поле ${fieldConfig.field} настроено`);
            } catch (error) {
                console.log(`⚠️  Поле ${fieldConfig.field}: ${error.response?.data?.errors?.[0]?.message || 'настройка пропущена'}`);
            }
        }
        
        console.log('✅ Интерфейс настроен');
        
    } catch (error) {
        console.error('❌ Ошибка настройки интерфейса:', error.response?.data || error.message);
        // Не прерываем выполнение, так как это не критично
    }
}

async function main() {
    try {
        console.log('🚀 Начинаем настройку Global API Keys\n');
        
        // 1. Создаем таблицу в базе данных
        await executeSQL();
        
        // 2. Авторизуемся в Directus
        const token = await authenticate();
        
        // 3. Обновляем схему Directus
        await refreshSchema(token);
        
        // 4. Настраиваем интерфейс
        await setupInterface(token);
        
        console.log('\n🎉 Настройка завершена!\n');
        console.log('Теперь в Directus админке таблица Global API Keys будет отображаться с только нужными полями:');
        console.log('- ID');
        console.log('- Сервис');
        console.log('- API Ключ (скрытый)');
        console.log('- Активен');
        console.log('- Описание');
        
    } catch (error) {
        console.error('\n❌ Ошибка выполнения:', error.message);
        process.exit(1);
    }
}

main();