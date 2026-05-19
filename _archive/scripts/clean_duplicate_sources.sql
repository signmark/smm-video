-- Скрипт для удаления дублирующихся источников с одинаковыми URL
-- Оставляет только первый источник для каждого уникального URL

-- 1. Сначала обновляем тренды, чтобы они ссылались на первый источник для каждого URL
UPDATE campaign_trends 
SET source_id = (
  SELECT MIN(id) 
  FROM campaign_sources cs2 
  WHERE cs2.url = (
    SELECT url 
    FROM campaign_sources cs3 
    WHERE cs3.id = campaign_trends.source_id
  )
)
WHERE source_id IS NOT NULL;

-- 2. Удаляем дубликаты, оставляя только первый источник для каждого URL
DELETE FROM campaign_sources 
WHERE id NOT IN (
  SELECT MIN(id) 
  FROM (
    SELECT id, url 
    FROM campaign_sources
  ) AS t 
  GROUP BY url
);

-- 3. Проверяем результат
SELECT 
  url,
  COUNT(*) as count_sources,
  STRING_AGG(name, ', ') as source_names,
  STRING_AGG(id::text, ', ') as source_ids
FROM campaign_sources 
GROUP BY url 
HAVING COUNT(*) > 1
ORDER BY url;