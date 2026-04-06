import { CampaignsReferenceDataPage } from './CampaignsReferenceDataPage';

export function MicrosoftCampaignsReferencePage() {
  return (
    <CampaignsReferenceDataPage
      tableName="microsoft_campaigns_reference_data"
      pageId="page-microsoft-campaigns-reference"
      title="Microsoft Campaigns Reference Data"
      description="Reference data for Microsoft (Bing) Ads campaigns (campaign name, country, product type, show name)"
      selectFields={['id', 'campaign_name', 'country', 'product_type', 'showname']}
      editableFields={['country', 'product_type', 'showname']}
      nameColumnLabel="Campaign Name"
    />
  );
}
