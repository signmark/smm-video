-- =====================================================
-- SQL для создания коллекций Telegram-каналов в Directus
-- =====================================================

-- 1. Таблица категорий Telegram-каналов
CREATE TABLE IF NOT EXISTS telegram_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    name_ru VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_es VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_created UUID REFERENCES directus_users(id),
    user_updated UUID REFERENCES directus_users(id)
);

-- 2. Таблица Telegram-каналов
CREATE TABLE IF NOT EXISTS telegram_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES telegram_categories(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    username VARCHAR(255) NOT NULL,
    link TEXT NOT NULL,
    subscribers INTEGER DEFAULT 0,
    description TEXT,
    language VARCHAR(10) DEFAULT 'ru',
    is_verified BOOLEAN DEFAULT false,
    avg_post_reach INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    content_type VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_created UUID REFERENCES directus_users(id),
    user_updated UUID REFERENCES directus_users(id)
);

-- 3. Индексы для быстрого поиска
CREATE INDEX idx_telegram_channels_category ON telegram_channels(category_id);
CREATE INDEX idx_telegram_channels_subscribers ON telegram_channels(subscribers DESC);
CREATE INDEX idx_telegram_channels_username ON telegram_channels(username);
CREATE INDEX idx_telegram_channels_language ON telegram_channels(language);
CREATE INDEX idx_telegram_channels_active ON telegram_channels(is_active);

-- 4. Начальные категории (примеры)
INSERT INTO telegram_categories (name, name_ru, name_en, name_es, description, icon) VALUES
('tech', 'Технологии', 'Technology', 'Tecnología', 'IT, гаджеты, новости технологий', 'laptop'),
('business', 'Бизнес', 'Business', 'Negocios', 'Предпринимательство, стартапы, бизнес-новости', 'briefcase'),
('marketing', 'Маркетинг', 'Marketing', 'Marketing', 'SMM, реклама, продвижение', 'megaphone'),
('food', 'Еда и кулинария', 'Food & Cooking', 'Comida y Cocina', 'Рецепты, рестораны, кулинария', 'utensils'),
('travel', 'Путешествия', 'Travel', 'Viajes', 'Туризм, путешествия, советы', 'plane'),
('fashion', 'Мода и красота', 'Fashion & Beauty', 'Moda y Belleza', 'Стиль, красота, мода', 'shirt'),
('health', 'Здоровье и фитнес', 'Health & Fitness', 'Salud y Fitness', 'ЗОЖ, спорт, здоровье', 'heart'),
('finance', 'Финансы', 'Finance', 'Finanzas', 'Инвестиции, криптовалюты, финансы', 'dollar-sign'),
('education', 'Образование', 'Education', 'Educación', 'Обучение, курсы, развитие', 'book'),
('entertainment', 'Развлечения', 'Entertainment', 'Entretenimiento', 'Юмор, развлечения, мемы', 'smile'),
('news', 'Новости', 'News', 'Noticias', 'Новостные каналы', 'newspaper'),
('crypto', 'Криптовалюты', 'Cryptocurrency', 'Criptomonedas', 'Крипто, блокчейн, NFT', 'bitcoin');

-- 5. Примеры каналов (можно заполнить вручную позже)
-- INSERT INTO telegram_channels (category_id, title, username, link, subscribers, description, language) VALUES
-- ((SELECT id FROM telegram_categories WHERE name = 'tech'), 'Название канала', 'channel_username', 'https://t.me/channel_username', 50000, 'Описание канала', 'ru');

-- Комментарии для понимания полей:
-- 
-- telegram_categories:
--   - name: уникальный slug на английском (для API)
--   - name_ru/en/es: переводы названия категории
--   - icon: название иконки из lucide-react
--
-- telegram_channels:
--   - username: @username канала без @
--   - link: полная ссылка t.me/username
--   - subscribers: количество подписчиков
--   - avg_post_reach: средний охват поста
--   - engagement_rate: процент вовлеченности (ER)
--   - content_type: тип контента (text, video, images, mixed)
--   - is_active: активен ли канал для рекомендаций
