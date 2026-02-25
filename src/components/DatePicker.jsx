import React, { useState, useRef, useEffect, useCallback } from 'react';

const PRESETS = [
  { label: 'All Data', key: 'all' },
  { label: 'Today', key: 'today' },
  { label: 'Yesterday', key: 'yesterday' },
  { label: 'Last 7 Days', key: 'last7' },
  { label: 'Last 14 Days', key: 'last14' },
  { label: 'Last 30 Days', key: 'last30' },
  { label: 'This Month', key: 'this_month' },
  { label: 'Last Month', key: 'last_month' },
  { label: 'Custom', key: 'custom' },
];

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* ── Date helpers ── */

function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function inRange(d, start, end) {
  if (!d || !start || !end) return false;
  const t = d.getTime(), s = start.getTime(), e = end.getTime();
  return t >= Math.min(s, e) && t <= Math.max(s, e);
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatShort(d) {
  if (!d) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isoStr(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function previousPeriod(from, to) {
  if (!from || !to) return { from: null, to: null };
  const diff = Math.round((to.getTime() - from.getTime()) / 86400000);
  const pTo = addDays(from, -1);
  const pFrom = addDays(pTo, -diff);
  return { from: pFrom, to: pTo };
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function resolvePreset(key) {
  const today = startOfDay(new Date());
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'last14': return { from: addDays(today, -13), to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'this_month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: first, to: last };
    }
    case 'all': return { from: new Date(2020, 0, 1), to: today };
    default: return null;
  }
}

function presetLabel(key) {
  const p = PRESETS.find(pr => pr.key === key);
  return p ? p.label : 'Custom';
}

/* ── Component ── */

export function DateRangePicker({ preset, dateFrom, dateTo, compareOn, compareFrom, compareTo, onApply }) {
  const containerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  const [draft, setDraft] = useState(() => ({
    preset: preset || 'last30',
    from: parseISO(dateFrom),
    to: parseISO(dateTo),
    compare: compareOn || false,
    compFrom: parseISO(compareFrom),
    compTo: parseISO(compareTo),
  }));

  const [selectMode, setSelectMode] = useState('primary-from');

  const [leftMonth, setLeftMonth] = useState(() => {
    const d = parseISO(dateFrom) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rightMonth, setRightMonth] = useState(() => {
    const d = parseISO(dateFrom) || new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  });

  const resetDraftFromProps = useCallback(() => {
    const f = parseISO(dateFrom);
    const t = parseISO(dateTo);
    setDraft({
      preset: preset || 'last30',
      from: f,
      to: t,
      compare: compareOn || false,
      compFrom: parseISO(compareFrom),
      compTo: parseISO(compareTo),
    });
    setSelectMode('primary-from');
    const base = f || new Date();
    setLeftMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setRightMonth(new Date(base.getFullYear(), base.getMonth() + 1, 1));
  }, [preset, dateFrom, dateTo, compareOn, compareFrom, compareTo]);

  const toggle = useCallback(() => {
    setIsOpen(prev => {
      if (!prev) resetDraftFromProps();
      return !prev;
    });
  }, [resetDraftFromProps]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleApply = useCallback(() => {
    onApply({
      preset: draft.preset,
      dateFrom: isoStr(draft.from),
      dateTo: isoStr(draft.to),
      compareOn: draft.compare,
      compareFrom: isoStr(draft.compFrom),
      compareTo: isoStr(draft.compTo),
    });
    setIsOpen(false);
  }, [draft, onApply]);

  useEffect(() => {
    function onDocClick(e) {
      if (isOpen && containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen]);

  /* ── Preset click ── */
  const handlePresetClick = useCallback((key) => {
    const range = resolvePreset(key);
    if (range) {
      setDraft(prev => {
        const next = { ...prev, preset: key, from: range.from, to: range.to };
        if (prev.compare) {
          const pp = previousPeriod(range.from, range.to);
          next.compFrom = pp.from;
          next.compTo = pp.to;
        }
        return next;
      });
      setSelectMode('primary-from');
      setLeftMonth(new Date(range.from.getFullYear(), range.from.getMonth(), 1));
      const rNext = new Date(range.from.getFullYear(), range.from.getMonth() + 1, 1);
      setRightMonth(rNext);
    } else {
      setDraft(prev => ({ ...prev, preset: key }));
      setSelectMode('primary-from');
    }
  }, []);

  /* ── Day click ── */
  const handleDayClick = useCallback((day) => {
    setDraft(prev => {
      const next = { ...prev, preset: 'custom' };
      if (selectMode === 'primary-from') {
        next.from = day;
        next.to = null;
        setSelectMode('primary-to');
      } else if (selectMode === 'primary-to') {
        if (day < prev.from) {
          next.from = day;
          next.to = prev.from;
        } else {
          next.to = day;
        }
        if (prev.compare) {
          const pp = previousPeriod(next.from, next.to);
          next.compFrom = pp.from;
          next.compTo = pp.to;
          setSelectMode('compare-from');
        } else {
          setSelectMode('primary-from');
        }
      } else if (selectMode === 'compare-from') {
        next.compFrom = day;
        next.compTo = null;
        setSelectMode('compare-to');
      } else if (selectMode === 'compare-to') {
        if (day < prev.compFrom) {
          next.compFrom = day;
          next.compTo = prev.compFrom;
        } else {
          next.compTo = day;
        }
        setSelectMode('primary-from');
      }
      return next;
    });
  }, [selectMode]);

  /* ── Compare toggle ── */
  const handleCompareToggle = useCallback((e) => {
    const checked = e.target.checked;
    setDraft(prev => {
      const next = { ...prev, compare: checked };
      if (checked && prev.from && prev.to) {
        const pp = previousPeriod(prev.from, prev.to);
        next.compFrom = pp.from;
        next.compTo = pp.to;
        setSelectMode('compare-from');
      } else if (!checked) {
        next.compFrom = null;
        next.compTo = null;
        setSelectMode('primary-from');
      }
      return next;
    });
  }, []);

  /* ── Month nav ── */
  const navLeft = useCallback((dir) => {
    setLeftMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  }, []);

  const navRight = useCallback((dir) => {
    setRightMonth(prev => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      if (next <= leftMonth) return prev;
      return next;
    });
  }, [leftMonth]);

  useEffect(() => {
    if (rightMonth <= leftMonth) {
      setRightMonth(new Date(leftMonth.getFullYear(), leftMonth.getMonth() + 1, 1));
    }
  }, [leftMonth, rightMonth]);

  /* ── Calendar renderer ── */
  function renderCalendar(monthDate, navHandlers) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const dim = daysInMonth(year, month);
    const firstDow = new Date(year, month, 1).getDay();
    const today = startOfDay(new Date());

    const cells = [];
    const prevDim = daysInMonth(year, month - 1);
    for (let i = firstDow - 1; i >= 0; i--) {
      cells.push({ day: prevDim - i, date: new Date(year, month - 1, prevDim - i), otherMonth: true });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({ day: d, date: new Date(year, month, d), otherMonth: false });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, date: new Date(year, month + 1, d), otherMonth: true });
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    return (
      <div className="dp-calendar">
        <div className="dp-cal-header">
          <button className="dp-cal-nav" onClick={() => navHandlers(-1)} type="button">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 9.5L4 6L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="dp-cal-title">{monthNames[month]} {year}</span>
          <button className="dp-cal-nav" onClick={() => navHandlers(1)} type="button">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="dp-cal-grid">
          {DOW.map(d => <span key={d} className="dp-cal-dow">{d}</span>)}
          {cells.map((c, i) => {
            const classes = ['dp-cal-day'];
            if (c.otherMonth) classes.push('other-month');
            if (sameDay(c.date, today)) classes.push('today');

            if (draft.from && sameDay(c.date, draft.from)) classes.push('selected', 'range-start');
            if (draft.to && sameDay(c.date, draft.to)) classes.push('selected', 'range-end');
            if (draft.from && draft.to && inRange(c.date, draft.from, draft.to)) classes.push('in-range');

            if (draft.compare) {
              if (draft.compFrom && sameDay(c.date, draft.compFrom)) classes.push('compare-selected', 'compare-start');
              if (draft.compTo && sameDay(c.date, draft.compTo)) classes.push('compare-selected', 'compare-end');
              if (draft.compFrom && draft.compTo && inRange(c.date, draft.compFrom, draft.compTo)) classes.push('compare-range');
            }

            return (
              <button
                key={i}
                type="button"
                className={classes.join(' ')}
                onClick={() => handleDayClick(c.date)}
              >
                {c.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Display text ── */
  const rangeLabelText = draft.from && draft.to
    ? `${formatShort(draft.from)} – ${formatShort(draft.to)}`
    : draft.from
      ? `${formatShort(draft.from)} – …`
      : 'Select dates';

  const compareRangeText = draft.compFrom && draft.compTo
    ? `${formatShort(draft.compFrom)} – ${formatShort(draft.compTo)}`
    : draft.compFrom
      ? `${formatShort(draft.compFrom)} – …`
      : '—';

  const rangeDisplayText = (() => {
    let txt = draft.from && draft.to
      ? `${formatShort(draft.from)} → ${formatShort(draft.to)}`
      : 'No range selected';
    if (draft.compare && draft.compFrom && draft.compTo) {
      txt += `  vs  ${formatShort(draft.compFrom)} → ${formatShort(draft.compTo)}`;
    }
    return txt;
  })();

  const hintText = (() => {
    switch (selectMode) {
      case 'primary-from': return 'Select start date';
      case 'primary-to': return 'Select end date';
      case 'compare-from': return 'Select compare start';
      case 'compare-to': return 'Select compare end';
      default: return '';
    }
  })();

  const triggerPresetLabel = presetLabel(
    preset || 'last30'
  );

  const triggerRangeText = (() => {
    const f = parseISO(dateFrom);
    const t = parseISO(dateTo);
    if (f && t) return `${formatShort(f)} – ${formatShort(t)}`;
    return 'Select dates';
  })();

  const triggerCompareText = (() => {
    const f = parseISO(compareFrom);
    const t = parseISO(compareTo);
    if (f && t) return `${formatShort(f)} – ${formatShort(t)}`;
    return '—';
  })();

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <div className={`date-picker-trigger ${isOpen ? 'active' : ''}`} onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <span className="dp-label">View:</span>
        <span className="dp-value">{triggerPresetLabel}</span>
        <span style={{ color: 'var(--border)', margin: '0 2px' }}>|</span>
        <span className="dp-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', fontWeight: 500 }}>{triggerRangeText}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-muted)', marginLeft: '2px' }}>
          <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {compareOn && (
        <div className="date-picker-trigger" style={{ fontSize: '12px' }} onClick={toggle}>
          <span className="dp-label" style={{ color: 'var(--primary)' }}>vs</span>
          <span className="dp-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', fontWeight: 500 }}>{triggerCompareText}</span>
        </div>
      )}

      <div className={`dp-dropdown ${isOpen ? 'open' : ''}`}>
        <div className="dp-presets">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className={`dp-preset-btn ${draft.preset === p.key ? 'active' : ''}`}
              onClick={() => handlePresetClick(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="dp-calendars">
            {renderCalendar(leftMonth, navLeft)}
            {renderCalendar(rightMonth, navRight)}
          </div>
          <div className="dp-footer">
            <div className="dp-footer-range">
              <span className="dp-range-display">{rangeDisplayText}</span>
            </div>
            <div className="dp-footer-controls">
              <div className="dp-footer-left">
                <span className="dp-tz">🕐 UTC</span>
                <label className="dp-compare-toggle">
                  <span className="toggle-switch">
                    <input type="checkbox" checked={draft.compare} onChange={handleCompareToggle} />
                    <span className="toggle-slider" />
                  </span>
                  Compare to
                </label>
                <span className="dp-selection-hint" style={{ color: selectMode.startsWith('compare') ? 'var(--primary)' : 'var(--navy)' }}>{hintText}</span>
              </div>
              <div className="dp-footer-right">
                <button className="btn btn-outline btn-sm" type="button" onClick={handleClose}>Cancel</button>
                <button className="btn btn-primary btn-sm" type="button" onClick={handleApply}>Apply Range</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
