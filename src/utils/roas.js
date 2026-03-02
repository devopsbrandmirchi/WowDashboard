/**
 * Calculate ROAS (Return on Ad Spend) for any platform.
 * ROAS = revenue / cost (or conversions_value / cost when revenue is not available).
 *
 * @param {number} cost - Total ad spend
 * @param {number} [revenueOrConversionsValue] - Revenue or conversions value (e.g. conversion value)
 * @returns {number} ROAS ratio (e.g. 2.5 for 2.5x). Returns 0 if cost is 0 or invalid.
 */
export function calculateRoas(cost, revenueOrConversionsValue) {
  const c = Number(cost);
  if (!c || c <= 0) return 0;
  const r = Number(revenueOrConversionsValue) || 0;
  return r / c;
}

/**
 * Calculate weighted ROAS across multiple segments (e.g. platforms).
 * Weighted ROAS = sum(cost_i * roas_i) / total_cost
 *
 * @param {Array<{ cost: number, roas: number }>} segments - Array of { cost, roas } per segment
 * @returns {number} Weighted ROAS
 */
export function calculateWeightedRoas(segments) {
  if (!Array.isArray(segments) || !segments.length) return 0;
  const totalCost = segments.reduce((s, x) => s + (Number(x.cost) || 0), 0);
  if (!totalCost) return 0;
  const weighted = segments.reduce((s, x) => s + (Number(x.cost) || 0) * (Number(x.roas) || 0), 0);
  return weighted / totalCost;
}
