import { CampaignsReferenceDataPage } from './CampaignsReferenceDataPage';

export function RedditCampaignsReferencePage() {
  return (
    <CampaignsReferenceDataPage
      tableName="reddit_campaigns_reference_data"
      pageId="page-reddit-campaigns-reference"
      title="Reddit Campaigns Reference Data"
      description="Reference data for Reddit Ads campaigns (campaign name, country, product type, show name)"
      selectFields={['id', 'campaign_name', 'country', 'product_type', 'showname']}
      editableFields={['country', 'product_type', 'showname']}
      nameColumnLabel="Campaign Name"
    />
  );
}
