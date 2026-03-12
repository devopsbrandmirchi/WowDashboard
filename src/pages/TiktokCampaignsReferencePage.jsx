import { CampaignsReferenceDataPage } from './CampaignsReferenceDataPage';

export function TiktokCampaignsReferencePage() {
  return (
    <CampaignsReferenceDataPage
      tableName="tiktok_campaigns_reference_data"
      pageId="page-tiktok-campaigns-reference"
      title="TikTok Campaigns Reference Data"
      description="Reference data for TikTok Ads campaigns (campaign name, country, product type, show name)"
      selectFields={['id', 'campaign_name', 'country', 'product_type', 'showname']}
      editableFields={['country', 'product_type', 'showname']}
      nameColumnLabel="Campaign Name"
    />
  );
}
