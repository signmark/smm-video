-- Add campaign_content columns required by the app (run after correct_directus_schema.sql)
-- Use: psql -U postgres -d directus -f scripts/directus/apply_schema_after_reset.sql
-- Or execute in PGAdmin against the directus database.

ALTER TABLE campaign_content
  ADD COLUMN IF NOT EXISTS additional_images JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS published_platforms JSONB DEFAULT '[]';

COMMENT ON COLUMN campaign_content.additional_images IS 'Additional image URLs (array)';
COMMENT ON COLUMN campaign_content.published_platforms IS 'Published platforms metadata';
