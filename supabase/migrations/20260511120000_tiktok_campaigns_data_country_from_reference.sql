-- Backfill public.tiktok_campaigns_data.country from public.tiktok_campaigns_reference_data
-- when the fact row has no country and reference has a non-empty country (trimmed campaign_name match).
-- If multiple reference rows share a campaign_name, use the row with the largest id.

UPDATE public.tiktok_campaigns_data AS d
SET country = left(src.country, 100)
FROM (
  SELECT DISTINCT ON (btrim(campaign_name::text))
    btrim(campaign_name::text) AS cname,
    btrim(country::text) AS country
  FROM public.tiktok_campaigns_reference_data
  WHERE campaign_name IS NOT NULL
    AND country IS NOT NULL
    AND btrim(country::text) <> ''
  ORDER BY btrim(campaign_name::text), id DESC
) AS src
WHERE d.campaign_name IS NOT NULL
  AND btrim(d.campaign_name::text) = src.cname
  AND (d.country IS NULL OR btrim(d.country::text) = '');
