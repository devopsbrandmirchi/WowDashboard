import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { partitionDatingAppCountryMetrics } from '../lib/parseDatingAppSubscriptionXlsx';

function toNum(v) {
  return Number(v) || 0;
}

function pickLatestUpload(uploads) {
  if (!uploads?.length) return null;
  const withPeriod = uploads.filter((u) => {
    const y = Number(u.report_year);
    const m = Number(u.report_month);
    return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
  });
  if (!withPeriod.length) return uploads[0];
  let best = withPeriod[0];
  for (let i = 1; i < withPeriod.length; i += 1) {
    const cur = withPeriod[i];
    const by = Number(best.report_year);
    const bm = Number(best.report_month);
    const cy = Number(cur.report_year);
    const cm = Number(cur.report_month);
    if (cy > by || (cy === by && cm > bm)) best = cur;
  }
  return best;
}

export function useDatingAppCombinedData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [byApp, setByApp] = useState([]);
  const [byCountry, setByCountry] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: uploads, error: upErr } = await supabase
        .from('dating_app_subscription_uploads')
        .select('id, report_year, report_month, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(50);
      if (upErr) throw upErr;
      const selectedUpload = pickLatestUpload(uploads || []);
      if (!selectedUpload?.id) {
        setByApp([]);
        setByCountry([]);
        return;
      }
      const { data: rows, error: metricsErr } = await supabase
        .from('dating_app_subscription_metrics')
        .select('*')
        .eq('upload_id', selectedUpload.id)
        .order('breakdown', { ascending: true });
      if (metricsErr) throw metricsErr;
      const mappedApp = (rows || [])
        .filter((r) => r.breakdown === 'by_app')
        .map((r) => ({
          row_label: r.row_label,
          is_total: r.is_total,
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          cpm: r.cpm,
          cpc: r.cpc,
        }));
      const mappedCountry = (rows || [])
        .filter((r) => r.breakdown === 'by_country')
        .map((r) => ({
          row_label: r.row_label,
          is_total: r.is_total,
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          cpm: r.cpm,
          cpc: r.cpc,
        }));
      const split = partitionDatingAppCountryMetrics({ byApp: mappedApp, byCountry: mappedCountry });
      setByApp(split.byApp || []);
      setByCountry(split.byCountry || []);
    } catch (err) {
      console.error('Dating app combined data fetch error:', err);
      setError(err?.message || 'Failed to fetch dating app subscription data');
      setByApp([]);
      setByCountry([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kpis = useMemo(() => {
    const rows = byApp.filter((r) => !r.is_total);
    const spend = rows.reduce((s, r) => s + toNum(r.spend), 0);
    const impressions = rows.reduce((s, r) => s + toNum(r.impressions), 0);
    const clicks = rows.reduce((s, r) => s + toNum(r.clicks), 0);
    return {
      cost: spend,
      impressions,
      clicks,
      conversions: 0,
      cpa: 0,
      roas: 0,
    };
  }, [byApp]);

  const countryData = useMemo(
    () =>
      byCountry
        .filter((r) => !r.is_total)
        .map((r) => ({
          name: r.row_label || 'Unknown',
          cost: toNum(r.spend),
          impressions: toNum(r.impressions),
          clicks: toNum(r.clicks),
          conversions: 0,
        })),
    [byCountry]
  );

  return {
    loading,
    error,
    kpis,
    countryData,
    fetchData,
  };
}
