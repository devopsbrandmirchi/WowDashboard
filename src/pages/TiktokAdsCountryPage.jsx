import { CountryMetricsPage } from './CountryMetricsPage';

export function TiktokAdsCountryPage() {
  return (
    <CountryMetricsPage
      title="TikTok Ads"
      subtitle="Country sync data from dedicated TikTok country tables"
      pageId="page-tiktok-ads-country"
      tableName="tiktok_campaigns_data_country"
      dateColumn="date"
      tabs={[
        { id: 'campaigns', label: 'Campaigns', field: 'campaignName' },
        { id: 'ad-groups', label: 'Ad Groups', field: 'adGroupName' },
        { id: 'ads', label: 'Ads', field: 'adName' },
        { id: 'placements', label: 'Placements', field: 'placement' },
        { id: 'country', label: 'Country', field: 'country' },
        { id: 'product', label: 'Product', field: 'product' },
        { id: 'titles', label: 'Titles', field: 'title' },
        { id: 'day', label: 'Day', field: 'day' },
      ]}
      mapRow={(r) => ({
        country: r.country,
        campaignName: r.campaign_name,
        adGroupName: r.ad_group_name,
        adName: r.ad_name,
        placement: r.placement,
        product: r.product_type,
        title: r.showname,
        cost: Number(r.amount_spent_usd || r.spend || r.cost) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        conversions: Number(r.conversions || r.total_purchase) || 0,
      })}
    />
  );
}
