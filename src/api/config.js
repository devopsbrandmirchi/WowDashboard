/**
 * API configuration. Set VITE_API_URL in .env or baseURL here when backend is connected.
 * Used by Meta Report (facebook_campaigns/statistics/campaign).
 */
export const API_CONFIG = {
  baseURL: import.meta.env.VITE_API_URL || '', // e.g. 'https://your-api.com'
  timeout: 15000,
};
