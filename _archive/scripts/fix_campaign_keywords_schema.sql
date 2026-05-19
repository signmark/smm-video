-- Fix campaign_keywords table schema to use VARCHAR for keyword field
-- This corrects the database structure to match what the application code expects

-- First, drop the existing campaign_keywords table if it exists
DROP TABLE IF EXISTS campaign_keywords CASCADE;

-- Drop the keywords reference table if it exists (not needed with direct VARCHAR approach)
DROP TABLE IF EXISTS keywords CASCADE;

-- Recreate campaign_keywords table with correct structure
CREATE TABLE campaign_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(255) DEFAULT 'published',
    sort INTEGER,
    user_created UUID REFERENCES directus_users(id),
    date_created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_updated UUID REFERENCES directus_users(id),
    date_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Main fields - keyword as VARCHAR, not UUID reference
    campaign_id UUID NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    trend_score DECIMAL(5,2) DEFAULT 0.0,
    mentions_count INTEGER DEFAULT 0,
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_campaign_id ON campaign_keywords(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_keyword ON campaign_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_campaign_keywords_trend_score ON campaign_keywords(trend_score);

-- Add unique constraint to prevent duplicate keywords per campaign
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_keywords_unique 
ON campaign_keywords(campaign_id, keyword);

-- Add comments for documentation
COMMENT ON TABLE campaign_keywords IS 'Keywords associated with campaigns';
COMMENT ON COLUMN campaign_keywords.campaign_id IS 'Reference to campaign';
COMMENT ON COLUMN campaign_keywords.keyword IS 'Keyword text (direct storage)';
COMMENT ON COLUMN campaign_keywords.trend_score IS 'Trend score from AI analysis';
COMMENT ON COLUMN campaign_keywords.mentions_count IS 'Number of mentions/competition level';
COMMENT ON COLUMN campaign_keywords.last_checked IS 'Last time this keyword was analyzed';