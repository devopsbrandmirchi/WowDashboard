import { CampaignsReferenceDataPage } from './CampaignsReferenceDataPage';

export function FacebookCampaignsReferencePage() {
  return (
    <CampaignsReferenceDataPage
      tableName="facebook_campaigns_reference_data"
      pageId="page-facebook-campaigns-reference"
      title="Facebook Campaigns Reference Data"
      description="Reference data for Facebook/Meta Ads campaigns (campaign ID, name, country, product type, show name)"
      selectFields={['id', 'campaign_id', 'campaign_name', 'country', 'product_type', 'showname']}
      editableFields={['country', 'product_type', 'showname']}
      nameColumnLabel="Campaign Name"
    />
  );
}
