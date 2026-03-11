/**
 * Role model – single source of truth for RBAC in WowDashboard.
 * DB column `roles.name` should use the slug (e.g. super_admin).
 * Display labels are for UI only.
 */

/** Stable UUIDs – keep in sync with Supabase seed (create_roles_and_role_permissions.sql) */
export const ROLE_IDS = {
  SUPER_ADMIN: '00000000-0000-0000-0000-000000000001',
  ADMIN: '00000000-0000-0000-0000-000000000002',
  EMPLOYEE: '00000000-0000-0000-0000-000000000003',
  VIEWER: '00000000-0000-0000-0000-000000000004',
  EDITOR: '00000000-0000-0000-0000-000000000005',
};

export const ROLES = [
  {
    id: ROLE_IDS.SUPER_ADMIN,
    slug: 'super_admin',
    label: 'Super Admin',
    description: 'Full access plus role and user management',
    rank: 5,
  },
  {
    id: ROLE_IDS.ADMIN,
    slug: 'admin',
    label: 'Admin',
    description: 'Full access to all pages and report tabs',
    rank: 4,
  },
  {
    id: ROLE_IDS.EDITOR,
    slug: 'editor',
    label: 'Editor',
    description: 'Edit access – configurable per permission set',
    rank: 3,
  },
  {
    id: ROLE_IDS.EMPLOYEE,
    slug: 'employee',
    label: 'Employee',
    description: 'Limited access – configurable per permission set',
    rank: 2,
  },
  {
    id: ROLE_IDS.VIEWER,
    slug: 'viewer',
    label: 'Viewer',
    description: 'View-only access – configurable per permission set',
    rank: 1,
  },
];

/** Permission keys reserved for role management (Super Admin only by default) */
export const PERMISSION_KEYS = {
  MANAGE_ROLES: 'admin:manage_roles',
  MANAGE_USERS: 'admin:manage_users',
};

/** All assignable permission keys, grouped for UI (Super Admin can assign which role accesses which) */
export const ALL_PERMISSION_KEYS = {
  sidebar: [
    'sidebar:dashboard',
    'sidebar:combined-reporting',
    'sidebar:google-ads',
    'sidebar:meta-ads',
    'sidebar:bing-ads',
    'sidebar:tiktok-ads',
    'sidebar:reddit-ads',
    'sidebar:subscriptions-analytics',
    'sidebar:subscriptions-subscribers',
    'sidebar:settings',
    'sidebar:roles-permissions',
    'sidebar:users',
  ],
  reportGoogleAds: [
    'report:google-ads:campaigntypes',
    'report:google-ads:campaigns',
    'report:google-ads:adgroups',
    'report:google-ads:keywords',
    'report:google-ads:searchterms',
    'report:google-ads:geo',
    'report:google-ads:country',
    'report:google-ads:product',
    'report:google-ads:shows',
    'report:google-ads:conversions',
  ],
  reportMetaAds: [
    'report:meta-ads:campaigns',
    'report:meta-ads:adsets',
    'report:meta-ads:country',
    'report:meta-ads:product',
    'report:meta-ads:shows',
    'report:meta-ads:placements',
    'report:meta-ads:day',
    'report:meta-ads:ads',
    'report:meta-ads:platform',
    'report:meta-ads:platformdevice',
  ],
  reportBingAds: [
    'report:bing-ads:overview',
  ],
  reportTiktokAds: [
    'report:tiktok-ads:campaigns',
    'report:tiktok-ads:adsets',
    'report:tiktok-ads:ads',
    'report:tiktok-ads:placements',
    'report:tiktok-ads:country',
    'report:tiktok-ads:product',
    'report:tiktok-ads:shows',
    'report:tiktok-ads:day',
  ],
  reportRedditAds: [
    'report:reddit-ads:campaigns',
    'report:reddit-ads:adgroups',
    'report:reddit-ads:placements',
    'report:reddit-ads:country',
    'report:reddit-ads:product',
    'report:reddit-ads:shows',
    'report:reddit-ads:day',
  ],
  /** Report table columns (toggle columns in reports – e.g. Google Ads, Meta, TikTok, Reddit) */
  tableColumns: [
    'column:type',           // Campaign Type
    'column:campaign_count', // # Campaigns
    'column:impressions',    // Impr.
    'column:clicks',        // Clicks
    'column:ctr',           // CTR
    'column:cpc',           // Avg CPC
    'column:cost',          // Cost
    'column:conversions',   // Conv.
    'column:conv_rate',     // Conv. Rate
    'column:cpa',           // CPA
    'column:spend_pct',     // % Spend
  ],
  admin: [PERMISSION_KEYS.MANAGE_ROLES, PERMISSION_KEYS.MANAGE_USERS],
};

export function getRoleBySlug(slug) {
  return ROLES.find((r) => r.slug === slug) ?? null;
}

export function getRoleById(id) {
  return ROLES.find((r) => r.id === id) ?? null;
}

/** Compare ranks: returns true if role A is at least as powerful as role B */
export function isRoleAtLeast(userRoleSlug, minSlug) {
  const userRole = getRoleBySlug(userRoleSlug);
  const minRole = getRoleBySlug(minSlug);
  if (!userRole || !minRole) return false;
  return userRole.rank >= minRole.rank;
}
