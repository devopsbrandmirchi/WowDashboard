-- If reddit/tiktok reference tables were created with campaign_id, drop it to match schema (id, campaign_name, country, product_type, showname).
ALTER TABLE public.reddit_campaigns_reference_data DROP COLUMN IF EXISTS campaign_id;
ALTER TABLE public.tiktok_campaigns_reference_data DROP COLUMN IF EXISTS campaign_id;
