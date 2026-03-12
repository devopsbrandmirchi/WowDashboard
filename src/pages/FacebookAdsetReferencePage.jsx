import { CampaignsReferenceDataPage } from './CampaignsReferenceDataPage';

export function FacebookAdsetReferencePage() {
  return (
    <CampaignsReferenceDataPage
      tableName="facebook_adset_reference_data"
      pageId="page-facebook-adset-reference"
      title="Facebook Adset Reference Data"
      description="Reference data for Facebook/Meta Ads ad sets (adset name, country, product type)"
      selectFields={['id', 'adset_name', 'country', 'product_type']}
      editableFields={['country', 'product_type']}
      nameColumnLabel="Adset Name"
    />
  );
}
