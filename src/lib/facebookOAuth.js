/**
 * Canonical Facebook Login redirect URI (root path with trailing slash).
 * Must match Meta app → Facebook Login → Valid OAuth Redirect URIs exactly,
 * and must match redirect_uri in the server-side code exchange.
 */
export function getFacebookOAuthRedirectUri() {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/`;
}

/** Graph API version for www.facebook.com dialog/oauth (keep in sync with Edge functions). */
export const FB_DIALOG_GRAPH_VERSION = 'v19.0';
