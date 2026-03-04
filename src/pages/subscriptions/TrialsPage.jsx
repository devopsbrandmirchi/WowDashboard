import { useState, useMemo } from 'react';
import { useVimeoSubscriptionsData } from '../../hooks/useVimeoSubscriptionsData';
import { formatNumber, formatDec } from '../../utils/format';

const PG = 50;

export function TrialsPage() {
  const { loading, error, rawData } = useVimeoSubscriptionsData();
  const [filterConverted, setFilterConverted] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const trialRecords = useMemo(() => {
    return rawData.filter((r) => r.trial_started_date != null);
  }, [rawData]);

  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const trialsThisMonth = trialRecords.filter((r) => {
      const d = new Date(r.trial_started_date);
      return d >= thisMonthStart && d <= thisMonthEnd;
    }).length;

    const converted = trialRecords.filter((r) => r.converted_trial && String(r.converted_trial).trim() !== '');
    const conversionRate = trialRecords.length > 0 ? (converted.length / trialRecords.length) * 100 : 0;

    let totalDays = 0;
    let convertCount = 0;
    converted.forEach((r) => {
      const start = new Date(r.trial_started_date);
      const end = r.date_became_enabled ? new Date(r.date_became_enabled) : null;
      if (end) {
        totalDays += Math.round((end - start) / 86400000);
        convertCount++;
      }
    });
    const avgDaysToConvert = convertCount > 0 ? totalDays / convertCount : 0;

    return {
      totalTrials: trialRecords.length,
      trialsThisMonth,
      conversionRate,
      avgDaysToConvert,
    };
  }, [trialRecords]);

  const filtered = useMemo(() => {
    let rows = trialRecords;
    if (filterConverted === 'yes') {
      rows = rows.filter((r) => r.converted_trial && String(r.converted_trial).trim() !== '');
    } else if (filterConverted === 'no') {
      rows = rows.filter((r) => !r.converted_trial || String(r.converted_trial).trim() === '');
    }
    if (filterCountry) {
      rows = rows.filter((r) => (r.country || '').toLowerCase() === filterCountry.toLowerCase());
    }
    if (dateFrom) {
      rows = rows.filter((r) => r.trial_started_date && r.trial_started_date >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((r) => r.trial_started_date && r.trial_started_date.slice(0, 10) <= dateTo);
    }
    return rows;
  }, [trialRecords, filterConverted, filterCountry, dateFrom, dateTo]);

  const countries = useMemo(() => [...new Set(trialRecords.map((r) => r.country).filter(Boolean))].sort(), [trialRecords]);

  const total = filtered.length;
  const pages = Math.ceil(total / PG) || 1;
  const start = (page - 1) * PG;
  const paginated = filtered.slice(start, start + PG);

  if (loading) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-section active">
        <div className="page-content">
          <p className="sub-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-section active" id="page-trials">
      <div className="page-content">
        <div className="page-title-bar">
          <h2>Trials</h2>
          <p>Trial analytics and conversion tracking</p>
        </div>

        <div className="sub-kpi-grid sub-kpi-grid-4">
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Total Trials Started</div>
            <div className="sub-kpi-value">{formatNumber(kpis.totalTrials)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Trials This Month</div>
            <div className="sub-kpi-value">{formatNumber(kpis.trialsThisMonth)}</div>
          </div>
          <div className="sub-kpi-card sub-kpi-green">
            <div className="sub-kpi-label">Conversion Rate</div>
            <div className="sub-kpi-value">{formatDec(kpis.conversionRate, 1)}%</div>
          </div>
          <div className="sub-kpi-card sub-kpi-blue">
            <div className="sub-kpi-label">Avg Days to Convert</div>
            <div className="sub-kpi-value">{formatDec(kpis.avgDaysToConvert, 1)}</div>
          </div>
        </div>

        <div className="panel sub-filters-panel">
          <div className="panel-body">
            <div className="sub-filters">
              <select value={filterConverted} onChange={(e) => setFilterConverted(e.target.value)}>
                <option value="">All</option>
                <option value="yes">Converted</option>
                <option value="no">Not Converted</option>
              </select>
              <select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
                <option value="">All Countries</option>
                {countries.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From" />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To" />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body no-padding">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Trial Started</th>
                  <th>Trial End</th>
                  <th>Converted</th>
                  <th>Current Plan</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.record_id || r.vimeo_email || Math.random()}>
                    <td>{r.vimeo_email || r.email || '—'}</td>
                    <td>{(r.first_name || '') + ' ' + (r.last_name || '')}</td>
                    <td>{r.country || '—'}</td>
                    <td>{r.trial_started_date ? new Date(r.trial_started_date).toLocaleDateString() : '—'}</td>
                    <td>{r.trial_end_date ? new Date(r.trial_end_date).toLocaleDateString() : '—'}</td>
                    <td>{r.converted_trial && String(r.converted_trial).trim() ? 'Yes' : 'No'}</td>
                    <td>{r.current_plan || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="sub-pagination">
                <span>Showing {start + 1}–{Math.min(start + PG, total)} of {formatNumber(total)}</span>
                <div className="sub-pg-btns">
                  <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                  <span>Page {page} of {pages}</span>
                  <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
