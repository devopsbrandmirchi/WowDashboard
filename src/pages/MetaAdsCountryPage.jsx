import { CountryMetricsPage } from './CountryMetricsPage';

export function MetaAdsCountryPage() {
  return (
    <CountryMetricsPage
      title="Meta Performance"
      subtitle="Country sync data from dedicated Meta country tables"
      metaTitleBar
      pageId="page-meta-ads-country"
      tableName="facebook_campaigns_data_country"
      dateColumn="day"
      showSearchFilters
      typeField="product"
      referenceTableName="facebook_campaigns_reference_data"
      referenceSelect="campaign_name,product_type,showname,country"
      sourceMatchField="campaign_name"
      referenceMatchField="campaign_name"
      tabs={[
        { id: 'campaigns', label: 'Campaigns', field: 'campaignName' },
        { id: 'adsets', label: 'Ad Sets', field: 'adSetName' },
        { id: 'country', label: 'Country', field: 'country' },
        { id: 'product', label: 'Product', field: 'product' },
        { id: 'titles', label: 'Titles', field: 'title' },
        { id: 'placements', label: 'Placements', field: 'placement' },
        { id: 'day', label: 'Day', field: 'day' },
        { id: 'ads', label: 'Ads', field: 'adName' },
        { id: 'platform', label: 'Platform', field: 'platform' },
        { id: 'platformdevice', label: 'Platform Device', field: 'devicePlatform' },
      ]}
      mapRow={(r, ref) => ({
        country: r.country || ref?.country || 'Unknown',
        campaignName: r.campaign_name,
        adSetName: r.adset_name,
        adName: r.ad_name,
        // Match MetaReportPage aggregation labels for empty values.
        placement: (r.placement ?? '').toString().trim() || 'Undefined',
        platform: (r.platform ?? '').toString().trim() || 'Undefined',
        devicePlatform: (r.device_platform ?? '').toString().trim() || 'Undefined',
        product: r.product_type || ref?.product_type || 'Unknown',
        title: r.showname || ref?.showname || 'Unknown',
        cost: Number(r.amount_spent_usd) || 0,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks_all) || 0,
        conversions: Number(r.purchases || r.meta_purchases) || 0,
      })}
    />
  );
}
