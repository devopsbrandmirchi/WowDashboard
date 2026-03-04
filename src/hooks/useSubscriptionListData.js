import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 1000;

function getMonthBounds(monthOffset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + monthOffset);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function useSubscriptionListData(metric) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState([]);

  const fetchForMetric = useCallback(async () => {
    if (!metric) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase.from('vimeo_subscriptions').select('*');
      const now = new Date();
      const thisMonth = getMonthBounds(0);
      const lastMonth = getMonthBounds(-1);

      switch (metric) {
        case 'total_active_subscribers':
          q = q.eq('status', 'enabled');
          break;
        case 'new_subscribers_this_month':
          q = q
            .gte('date_became_enabled', thisMonth.startIso)
            .lte('date_became_enabled', thisMonth.endIso);
          break;
        case 'new_subscribers_last_month':
          q = q
            .gte('date_became_enabled', lastMonth.startIso)
            .lte('date_became_enabled', lastMonth.endIso);
          break;
        case 'month_over_month_growth':
          q = q
            .gte('date_became_enabled', thisMonth.startIso)
            .lte('date_became_enabled', thisMonth.endIso);
          break;
        case 'active_trials':
          q = q
            .not('trial_started_date', 'is', null)
            .not('trial_end_date', 'is', null)
            .gt('trial_end_date', now.toISOString());
          break;
        case 'trial_conversions_this_month':
          q = q
            .not('converted_trial', 'is', null)
            .neq('converted_trial', '')
            .gte('date_became_enabled', thisMonth.startIso)
            .lte('date_became_enabled', thisMonth.endIso);
          break;
        case 'cancellations_this_month':
          q = q
            .gte('date_last_canceled', thisMonth.startIso)
            .lte('date_last_canceled', thisMonth.endIso);
          break;
        case 'churn_rate':
          q = q
            .gte('date_last_canceled', thisMonth.startIso)
            .lte('date_last_canceled', thisMonth.endIso);
          break;
        case 'mrr':
          q = q.eq('status', 'enabled');
          break;
        case 'avg_lifetime_value':
          q = q.gt('lifetime_value', 0);
          break;
        default:
          q = q.limit(100);
      }

      const results = [];
      let offset = 0;
      while (true) {
        const { data: chunk, error: err } = await q
          .order('synced_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (err) throw err;
        if (!chunk || chunk.length === 0) break;
        results.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (metric === 'active_trials') {
        setData(
          results.filter((r) => {
            const enabled = (r.status || '').toLowerCase() === 'enabled';
            const converted = r.converted_trial && String(r.converted_trial).trim() !== '';
            return !enabled || !converted;
          })
        );
      } else {
        setData(results);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    fetchForMetric();
  }, [fetchForMetric]);

  return { loading, error, data, refetch: fetchForMetric };
}
