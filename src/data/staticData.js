/**
 * Static data for current client – no backend connected.
 * Replace with API calls from src/api when backend is ready.
 */

export const STATIC = {
  exec: {
    kpis: {
      totalSpend:       { value: 10000,  label: 'Total Ad Spend',     icon: '$',  iconBg: 'var(--primary-bg)', iconColor: 'var(--primary)',  sub: 'All channels', subClass: 'neutral' },
      totalConversions: { value: 1000,   label: 'Total Conversions',  icon: '✓',  iconBg: 'var(--accent-bg)',  iconColor: 'var(--accent)',   sub: 'Across all ad platforms', subClass: 'neutral' },
      blendedCPA:       { value: 10.00,  label: 'Blended CPA',        icon: '⬇',  iconBg: 'var(--warning-bg)', iconColor: 'var(--warning)',  sub: 'Lower is better', subClass: 'neutral', isCurrency: true },
      websiteRevenue:   { value: 25000,  label: 'Website Revenue',    icon: '💰', iconBg: 'var(--accent-bg)',  iconColor: 'var(--accent)',   sub: 'Conv. value', subClass: 'neutral' },
      blendedROAS:      { value: 2.50,   label: 'ROAS (Blended)',     icon: '📈', iconBg: 'var(--purple-bg)',  iconColor: 'var(--purple)',   sub: 'Revenue / Spend', subClass: 'neutral', isRoas: true },
      totalImpressions: { value: 500000, label: 'Total Impressions',  icon: '👁', iconBg: 'var(--primary-bg)', iconColor: 'var(--primary)',  sub: 'Incl. all channels', subClass: 'neutral', isShort: true },
    },
    insight: 'Dashboard shows <strong>static data</strong> for the current client. Connect the backend API in <code>src/api</code> to load live numbers.',
    spendByPlatform: [
      { name: 'Google Ads',  spend: 4000,  color: 'var(--google)',  dotStyle: 'var(--google)' },
      { name: 'Meta Ads',    spend: 3000,  color: 'var(--meta)',    dotStyle: 'var(--meta)' },
      { name: 'Reddit',      spend: 1500,  color: 'var(--reddit)',  dotStyle: 'var(--reddit)' },
      { name: 'TikTok',      spend: 1000,  color: 'var(--tiktok)',  dotStyle: 'var(--tiktok)' },
      { name: 'Bing Ads',    spend: 500,   color: 'var(--bing)',    dotStyle: 'var(--bing)' },
    ],
    platformEfficiency: [
      { name: 'Google Ads',  dotColor: 'var(--google)',  spend: 4000,  conv: 400,  cpa: 10.00,  roas: 2.50, roasBadge: 'badge-green' },
      { name: 'Meta Ads',    dotColor: 'var(--meta)',    spend: 3000,  conv: 300,  cpa: 10.00,  roas: 2.50, roasBadge: 'badge-green' },
      { name: 'Reddit',      dotColor: 'var(--reddit)',  spend: 1500,  conv: 150,  cpa: 10.00,  roas: 2.50, roasBadge: 'badge-blue' },
      { name: 'TikTok',      dotColor: 'var(--tiktok)',  spend: 1000,  conv: 100,  cpa: 10.00,  roas: 2.50, roasBadge: 'badge-yellow' },
      { name: 'Bing Ads',    dotColor: 'var(--bing)',    spend: 500,   conv: 50,   cpa: 10.00,  roas: 2.50, roasBadge: 'badge-green' },
    ],
    funnel: {
      trials:         5000,
      conversionRate: 50.0,
      paidSubs:       2500,
      revenue:        25000,
      projectedLTV:   50000,
    },
    geoDistribution: [
      { region: '🇺🇸 United States', spend: 5000, conv: 500, cpa: 10.00, share: 50.0 },
      { region: '🇬🇧 United Kingdom', spend: 2500, conv: 250, cpa: 10.00, share: 25.0 },
      { region: '🇪🇺 Europe (EU)',    spend: 2000, conv: 200, cpa: 10.00, share: 20.0 },
      { region: '🌍 Other',           spend: 500,  conv: 50,  cpa: 10.00, share: 5.0 },
    ],
    leadPerformance: [
      { location: 'Florida',   spend: 3000, clicks: 1000, calls: 80,  forms: 20, leads: 100, cpc: 3.00, cpl: 30.00, mom: '+10.0%', momBadge: 'badge-green' },
      { location: 'Michigan',  spend: 2000, clicks: 800,  calls: 50,  forms: 15, leads: 65,  cpc: 2.50, cpl: 30.77, mom: '+5.0%',  momBadge: 'badge-green' },
      { location: 'Kentucky',  spend: 1000, clicks: 500,  calls: 30,  forms: 10, leads: 40,  cpc: 2.00, cpl: 25.00, mom: '-8.0%',  momBadge: 'badge-red' },
      { location: 'Louisiana', spend: 1000, clicks: 400,  calls: 25,  forms: 5,  leads: 30,  cpc: 2.50, cpl: 33.33, mom: '+3.0%',  momBadge: 'badge-green' },
    ],
    budgetAllocation: [
      { channel: 'Google PPC',      allocation: '$4k – $5k',  notes: 'Best CPA performer' },
      { channel: 'FB / Instagram',  allocation: '$3k – $4k',  notes: 'Volume driver' },
      { channel: 'Reddit',          allocation: '$1k – $2k',  notes: 'Scale conversation ads' },
      { channel: 'TikTok',          allocation: '$1k – $1.5k', notes: 'Test & optimize' },
      { channel: 'Bing Ads',        allocation: '$500 – $1k', notes: 'New channel' },
    ],
    chartRevenueTrend: {
      labels:  ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
      revenue: [6000, 6500, 6000, 6500],
      spend:   [2400, 2600, 2500, 2500],
    },
  },
  googleAds: {
    kpis: {
      spend:       4000,
      clicks:      2000,
      conversions: 400,
      cpa:         10.00,
      roas:        2.50,
      revenue:     10000,
      impressions: 200000,
      ctr:         1.00,
      avgCpc:      2.00,
      campaigns:   5,
    },
    campaignTypes: [
      { type: 'Search',  cost: 2400, conversions: 240, conversions_value: 6000 },
      { type: 'PMax',    cost: 1200, conversions: 120, conversions_value: 3000 },
      { type: 'Display', cost: 300,  conversions: 30,  conversions_value: 750 },
      { type: 'App',     cost: 100,  conversions: 10,  conversions_value: 250 },
    ],
    keywords: [
      { keyword: 'brand + product',     clicks: 500, conv: 50,  revenue: 1250 },
      { keyword: 'category intent',     clicks: 400, conv: 40,  revenue: 1000 },
      { keyword: 'competitor comparison', clicks: 300, conv: 30,  revenue: 750 },
      { keyword: 'informational',      clicks: 200, conv: 20,  revenue: 500 },
    ],
    geography: [
      { country: '🇺🇸 US',      spend: 2000, conv: 200, cpa: 10.00, roas: 2.50 },
      { country: '🇬🇧 UK',      spend: 1000, conv: 100, cpa: 10.00, roas: 2.50 },
      { country: '🇫🇷 France',  spend: 400,  conv: 40,  cpa: 10.00, roas: 2.50 },
      { country: '🇩🇪 Germany', spend: 300,  conv: 30,  cpa: 10.00, roas: 2.50 },
      { country: '🌍 Others',   spend: 300,  conv: 30,  cpa: 10.00, roas: 2.50 },
    ],
  },
};

export const PAGE_TITLES = {
  dashboard: 'Executive Dashboard',
  'google-ads': 'Google Ads Performance',
  'meta-ads': 'Meta Ads Performance',
  'bing-ads': 'Bing / Microsoft Ads',
  'tiktok-ads': 'TikTok Ads Performance',
  'reddit-ads': 'Reddit Ads Performance',
  'amazon-ads': 'Amazon Ads Performance',
  dsp: 'DSP / Programmatic',
  'dating-apps': 'Dating Apps / Direct Buys',
  ctv: 'CTV Campaigns',
  ga4: 'GA4 / Web Analytics',
  email: 'Email Marketing',
  ghl: 'GoHighLevel CRM',
  ott: 'OTT / Vimeo',
  seo: 'SEO Performance',
  geo: 'Geographic View',
  creatives: 'Creative Analysis',
  events: 'Events / Special Campaigns',
  settings: 'White-Label Settings',
};

export const CLIENTS = [
  'WOW Presents Plus',
  'Johnson Bros Ford',
  'Neulife Rehabilitation',
  'Pure For Men',
];
