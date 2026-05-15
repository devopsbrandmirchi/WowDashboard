import { CountryMetricsPage } from './CountryMetricsPage';

export function RedditAdsCountryPage() {
  return (
    <CountryMetricsPage
      title="Reddit Data Metrics"
      subtitle="Country sync data from dedicated Reddit country tables"
      pageId="page-reddit-ads-country"
      tableName="reddit_campaigns_ad_group_country"
      dateColumn="campaign_date"
      tabs={[
        { id: 'campaigns', label: 'Campaigns', field: 'campaignName' },
        { id: 'ad-groups', label: 'Ad Groups', field: 'adGroupName' },
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
        placement: r.placement,
        product: r.product_type,
        title: r.showname,
        cost: Number(r.amount_spent_usd || r.total_spent || r.cost) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        conversions: (Number(r.purchase_click) || 0) + (Number(r.purchase_view) || 0),
      })}
    />
  );
}
