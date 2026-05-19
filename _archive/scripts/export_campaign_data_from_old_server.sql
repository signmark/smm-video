-- Экспорт всех данных кампаний со старого Directus сервера
-- Выполнить на старом сервере (45.130.212.62) в базе directus

-- 1. Экспорт кампаний
SELECT 
    'INSERT INTO campaigns (id, title, description, target_audience, user_created, date_created, date_updated, status) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(COALESCE(title, '')) || ', ' ||
    quote_literal(COALESCE(description, '')) || ', ' ||
    quote_literal(COALESCE(target_audience, '')) || ', ' ||
    quote_literal(COALESCE(user_created, '')) || ', ' ||
    CASE WHEN date_created IS NULL THEN 'NULL' ELSE quote_literal(date_created::text) END || ', ' ||
    CASE WHEN date_updated IS NULL THEN 'NULL' ELSE quote_literal(date_updated::text) END || ', ' ||
    quote_literal(COALESCE(status, 'draft')) ||
    ') ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, target_audience = EXCLUDED.target_audience, status = EXCLUDED.status;'
FROM campaigns
ORDER BY date_created;

-- 2. Экспорт анкет кампаний
SELECT 
    'INSERT INTO campaign_questionnaire (id, campaign_id, company_name, contact_info, business_description, target_audience, goals, budget, timeline, additional_requirements, user_created, date_created) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(COALESCE(campaign_id, '')) || ', ' ||
    quote_literal(COALESCE(company_name, '')) || ', ' ||
    quote_literal(COALESCE(contact_info, '')) || ', ' ||
    quote_literal(COALESCE(business_description, '')) || ', ' ||
    quote_literal(COALESCE(target_audience, '')) || ', ' ||
    quote_literal(COALESCE(goals, '')) || ', ' ||
    quote_literal(COALESCE(budget, '')) || ', ' ||
    quote_literal(COALESCE(timeline, '')) || ', ' ||
    quote_literal(COALESCE(additional_requirements, '')) || ', ' ||
    quote_literal(COALESCE(user_created, '')) || ', ' ||
    CASE WHEN date_created IS NULL THEN 'NULL' ELSE quote_literal(date_created::text) END ||
    ') ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, business_description = EXCLUDED.business_description, goals = EXCLUDED.goals;'
FROM campaign_questionnaire
ORDER BY date_created;

-- 3. Экспорт контента кампаний
SELECT 
    'INSERT INTO campaign_content (id, campaign_id, title, content, content_type, status, scheduled_time, social_platforms, user_created, date_created, date_updated) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(COALESCE(campaign_id, '')) || ', ' ||
    quote_literal(COALESCE(title, '')) || ', ' ||
    quote_literal(COALESCE(content, '')) || ', ' ||
    quote_literal(COALESCE(content_type, 'post')) || ', ' ||
    quote_literal(COALESCE(status, 'draft')) || ', ' ||
    CASE WHEN scheduled_time IS NULL THEN 'NULL' ELSE quote_literal(scheduled_time::text) END || ', ' ||
    CASE WHEN social_platforms IS NULL THEN 'NULL' ELSE quote_literal(social_platforms::text) END || ', ' ||
    quote_literal(COALESCE(user_created, '')) || ', ' ||
    CASE WHEN date_created IS NULL THEN 'NULL' ELSE quote_literal(date_created::text) END || ', ' ||
    CASE WHEN date_updated IS NULL THEN 'NULL' ELSE quote_literal(date_updated::text) END ||
    ') ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, status = EXCLUDED.status, social_platforms = EXCLUDED.social_platforms;'
FROM campaign_content
ORDER BY date_created;

-- 4. Экспорт аналитики кампаний
SELECT 
    'INSERT INTO campaign_analytics (id, campaign_id, content_id, platform, metrics, date_recorded, user_created) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(COALESCE(campaign_id, '')) || ', ' ||
    quote_literal(COALESCE(content_id, '')) || ', ' ||
    quote_literal(COALESCE(platform, '')) || ', ' ||
    CASE WHEN metrics IS NULL THEN 'NULL' ELSE quote_literal(metrics::text) END || ', ' ||
    CASE WHEN date_recorded IS NULL THEN 'NULL' ELSE quote_literal(date_recorded::text) END || ', ' ||
    quote_literal(COALESCE(user_created, '')) ||
    ') ON CONFLICT (id) DO UPDATE SET metrics = EXCLUDED.metrics, date_recorded = EXCLUDED.date_recorded;'
FROM campaign_analytics
ORDER BY date_recorded;

-- 5. Экспорт Global API Keys
SELECT 
    'INSERT INTO global_api_keys (id, service_name, api_key, is_active, description, user_created, date_created) VALUES (' ||
    quote_literal(id) || ', ' ||
    quote_literal(service_name) || ', ' ||
    quote_literal(api_key) || ', ' ||
    COALESCE(is_active, true) || ', ' ||
    quote_literal(COALESCE(description, '')) || ', ' ||
    quote_literal(COALESCE(user_created, '')) || ', ' ||
    CASE WHEN date_created IS NULL THEN 'NULL' ELSE quote_literal(date_created::text) END ||
    ') ON CONFLICT (service_name) DO UPDATE SET api_key = EXCLUDED.api_key, is_active = EXCLUDED.is_active, description = EXCLUDED.description;'
FROM global_api_keys
ORDER BY service_name;

-- 6. Статистика экспорта
SELECT 
    'campaigns' as table_name,
    COUNT(*) as records_count
FROM campaigns
UNION ALL
SELECT 
    'campaign_questionnaire' as table_name,
    COUNT(*) as records_count
FROM campaign_questionnaire
UNION ALL
SELECT 
    'campaign_content' as table_name,
    COUNT(*) as records_count
FROM campaign_content
UNION ALL
SELECT 
    'campaign_analytics' as table_name,
    COUNT(*) as records_count
FROM campaign_analytics
UNION ALL
SELECT 
    'global_api_keys' as table_name,
    COUNT(*) as records_count
FROM global_api_keys;