-- Спорт и развлечения (entertainment - aa94a23a-64b6-4de5-ac16-ab1c2a6706c8)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('sportsdaily', 'Спорт Daily', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 850000, 95000, 11.2, 'ru', 'https://t.me/sportsdaily'),
('bowling_ru', 'Боулинг в России', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 45000, 5200, 11.6, 'ru', 'https://t.me/bowling_ru'),
('activesport', 'Активный спорт', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 120000, 14000, 11.7, 'ru', 'https://t.me/activesport'),
('sport_life_ru', 'Спортивная жизнь', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 320000, 38000, 11.9, 'ru', 'https://t.me/sport_life_ru'),
('football_news', 'Футбольные новости', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 680000, 78000, 11.5, 'ru', 'https://t.me/football_news'),
('championat', 'Чемпионат', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 950000, 110000, 11.6, 'ru', 'https://t.me/championat'),
('sportexpress', 'Спорт Экспресс', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 780000, 89000, 11.4, 'ru', 'https://t.me/sportexpress'),
('fitness_motivation', 'Фитнес мотивация', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 210000, 24000, 11.4, 'ru', 'https://t.me/fitness_motivation'),
('martial_arts', 'Боевые искусства', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 135000, 16000, 11.9, 'ru', 'https://t.me/martial_arts'),
('extreme_sports', 'Экстремальный спорт', 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 95000, 11000, 11.6, 'ru', 'https://t.me/extreme_sports')
ON CONFLICT (username) DO NOTHING;

-- Tech (c336d3c3-746c-4d55-b401-765fb982b5ce)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('tproger', 'Типичный программист', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 280000, 32000, 11.4, 'ru', 'https://t.me/tproger'),
('techmind', 'TechMind', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 195000, 23000, 11.8, 'ru', 'https://t.me/techmind'),
('vc_news', 'VC.ru', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 420000, 48000, 11.4, 'ru', 'https://t.me/vc_news'),
('itworld', 'IT World', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 350000, 40000, 11.4, 'ru', 'https://t.me/itworld'),
('wylsa', 'Wylsacom', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 580000, 66000, 11.4, 'ru', 'https://t.me/wylsa'),
('gadgets_russia', 'Гаджеты России', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 230000, 26000, 11.3, 'ru', 'https://t.me/gadgets_russia'),
('ai_newz', 'AI Новости', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 175000, 20000, 11.4, 'ru', 'https://t.me/ai_newz'),
('tech_startups', 'Tech Стартапы', 'c336d3c3-746c-4d55-b401-765fb982b5ce', 145000, 17000, 11.7, 'ru', 'https://t.me/tech_startups')
ON CONFLICT (username) DO NOTHING;

-- Business (16874c0e-8f29-4d91-a3e5-c60bdcfd92c4)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('businessru', 'Бизнес России', '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 310000, 36000, 11.6, 'ru', 'https://t.me/businessru'),
('startuplife', 'Startup Life', '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 175000, 21000, 12.0, 'ru', 'https://t.me/startuplife'),
('forbes_ru', 'Forbes Россия', '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 520000, 59000, 11.3, 'ru', 'https://t.me/forbes_ru'),
('entrepreneur_ru', 'Предприниматель', '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 285000, 33000, 11.6, 'ru', 'https://t.me/entrepreneur_ru'),
('business_ideas', 'Бизнес идеи', '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 195000, 22000, 11.3, 'ru', 'https://t.me/business_ideas')
ON CONFLICT (username) DO NOTHING;

-- Marketing (74592250-a310-4bad-88c1-09f17f1afd32)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('smmexperts', 'SMM эксперты', '74592250-a310-4bad-88c1-09f17f1afd32', 145000, 17000, 11.7, 'ru', 'https://t.me/smmexperts'),
('digitalmarketingru', 'Digital маркетинг', '74592250-a310-4bad-88c1-09f17f1afd32', 190000, 22000, 11.6, 'ru', 'https://t.me/digitalmarketingru'),
('seo_news', 'SEO новости', '74592250-a310-4bad-88c1-09f17f1afd32', 125000, 14000, 11.2, 'ru', 'https://t.me/seo_news'),
('targetolog', 'Таргетолог', '74592250-a310-4bad-88c1-09f17f1afd32', 165000, 19000, 11.5, 'ru', 'https://t.me/targetolog')
ON CONFLICT (username) DO NOTHING;

-- Food (7a6e03da-e9ef-4822-bd78-1a9ef56a2077)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('foodblogger', 'Фуд блогер', '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', 260000, 31000, 11.9, 'ru', 'https://t.me/foodblogger'),
('restaurantguide', 'Гид по ресторанам', '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', 135000, 16000, 11.9, 'ru', 'https://t.me/restaurantguide'),
('recipes_ru', 'Рецепты России', '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', 385000, 44000, 11.4, 'ru', 'https://t.me/recipes_ru')
ON CONFLICT (username) DO NOTHING;

-- Travel (0b580755-2872-44d8-8d5c-ffdfa1983c15)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('travelworld', 'Мир путешествий', '0b580755-2872-44d8-8d5c-ffdfa1983c15', 380000, 44000, 11.6, 'ru', 'https://t.me/travelworld'),
('adventuretime', 'Время приключений', '0b580755-2872-44d8-8d5c-ffdfa1983c15', 215000, 25000, 11.6, 'ru', 'https://t.me/adventuretime'),
('travel_ru', 'Путешествия по России', '0b580755-2872-44d8-8d5c-ffdfa1983c15', 295000, 34000, 11.5, 'ru', 'https://t.me/travel_ru')
ON CONFLICT (username) DO NOTHING;

-- Fashion (a88dac45-de51-4119-9253-05945986b3b5)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('fashionista_ru', 'Fashionista Russia', 'a88dac45-de51-4119-9253-05945986b3b5', 295000, 34000, 11.5, 'ru', 'https://t.me/fashionista_ru'),
('beautytips', 'Советы красоты', 'a88dac45-de51-4119-9253-05945986b3b5', 185000, 22000, 11.9, 'ru', 'https://t.me/beautytips'),
('style_guide', 'Гид по стилю', 'a88dac45-de51-4119-9253-05945986b3b5', 225000, 26000, 11.6, 'ru', 'https://t.me/style_guide')
ON CONFLICT (username) DO NOTHING;

-- Health (9d75d053-24c5-4635-b8c0-58dcd3e7bd03)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('healthylifestyle', 'Здоровый образ жизни', '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', 340000, 39000, 11.5, 'ru', 'https://t.me/healthylifestyle'),
('fitnesscoach', 'Фитнес тренер', '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', 205000, 24000, 11.7, 'ru', 'https://t.me/fitnesscoach'),
('yoga_ru', 'Йога в России', '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', 175000, 20000, 11.4, 'ru', 'https://t.me/yoga_ru')
ON CONFLICT (username) DO NOTHING;

-- Finance (8cecc24c-90a4-4511-b898-59f96a6b0b03)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('financeexpert', 'Финансовый эксперт', '8cecc24c-90a4-4511-b898-59f96a6b0b03', 275000, 32000, 11.6, 'ru', 'https://t.me/financeexpert'),
('investpro', 'Инвест Про', '8cecc24c-90a4-4511-b898-59f96a6b0b03', 195000, 23000, 11.8, 'ru', 'https://t.me/investpro'),
('finance_ru', 'Финансы России', '8cecc24c-90a4-4511-b898-59f96a6b0b03', 385000, 44000, 11.4, 'ru', 'https://t.me/finance_ru')
ON CONFLICT (username) DO NOTHING;

-- Education (d6c42fc0-c8a4-4415-a7e3-8737c7ccd7af)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('eduplatform', 'Образовательная платформа', 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', 225000, 26000, 11.6, 'ru', 'https://t.me/eduplatform'),
('learnonline', 'Учись онлайн', 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', 165000, 19000, 11.5, 'ru', 'https://t.me/learnonline'),
('courses_ru', 'Курсы России', 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', 195000, 22000, 11.3, 'ru', 'https://t.me/courses_ru')
ON CONFLICT (username) DO NOTHING;

-- News (329c0622-6528-4046-9780-6b452c017c81)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('newstoday', 'Новости сегодня', '329c0622-6528-4046-9780-6b452c017c81', 520000, 60000, 11.5, 'ru', 'https://t.me/newstoday'),
('dailynews', 'Ежедневные новости', '329c0622-6528-4046-9780-6b452c017c81', 395000, 46000, 11.6, 'ru', 'https://t.me/dailynews'),
('ria_novosti', 'РИА Новости', '329c0622-6528-4046-9780-6b452c017c81', 1250000, 145000, 11.6, 'ru', 'https://t.me/ria_novosti')
ON CONFLICT (username) DO NOTHING;

-- Crypto (14510433-569e-4f29-bf82-6e56a2b3947f)
INSERT INTO telegram_channels (username, title, category_id, subscribers, avg_post_reach, engagement_rate, language, link) VALUES
('cryptonews', 'Крипто новости', '14510433-569e-4f29-bf82-6e56a2b3947f', 285000, 33000, 11.6, 'ru', 'https://t.me/cryptonews'),
('bitcoinru', 'Bitcoin Russia', '14510433-569e-4f29-bf82-6e56a2b3947f', 245000, 29000, 11.8, 'ru', 'https://t.me/bitcoinru'),
('blockchain_news', 'Blockchain новости', '14510433-569e-4f29-bf82-6e56a2b3947f', 195000, 22000, 11.3, 'ru', 'https://t.me/blockchain_news')
ON CONFLICT (username) DO NOTHING;
