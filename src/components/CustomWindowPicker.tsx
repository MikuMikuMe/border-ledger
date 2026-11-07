import { useState } from 'react';
import { validDateRange } from '../domain/reporting';
import type { ReportWindow } from '../domain/types';

export function CustomWindowPicker({ windows, selectedWindow, onPreset, onApply }: { windows: ReportWindow[]; selectedWindow: ReportWindow; onPreset: (key: ReportWindow['key']) => void; onApply: (start: string, end: string) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(selectedWindow.start);
  const [end, setEnd] = useState(selectedWindow.end);
  const valid = validDateRange(start, end);
  return <div className="custom-window"><div className="window-picker" role="group" aria-label="Reporting window">{windows.map(window => <button key={window.key} type="button" className={selectedWindow.key === window.key ? 'is-selected' : ''} onClick={() => { setOpen(false); onPreset(window.key); }} aria-pressed={selectedWindow.key === window.key}>{window.label}</button>)}<button type="button" className={selectedWindow.key === 'custom' ? 'is-selected' : ''} aria-pressed={selectedWindow.key === 'custom'} aria-expanded={open} onClick={() => { setStart(selectedWindow.start); setEnd(selectedWindow.end); setOpen(!open); }}>Custom</button></div>
    {open ? <form className="custom-window-form" onSubmit={event => { event.preventDefault(); if (valid) { onApply(start, end); setOpen(false); } }}><label>Start date<input type="date" value={start} onChange={event => setStart(event.target.value)} required /></label><label>End date<input type="date" value={end} onChange={event => setEnd(event.target.value)} required /></label>{!valid ? <p role="alert">Enter valid dates with the start on or before the end.</p> : null}<button className="outline-button" type="submit" disabled={!valid}>Apply range</button></form> : null}
  </div>;
}


export function CustomChartNote({window, range}: {window: ReportWindow; range: 'daily' | 'weekly' | 'monthly'}) {
  if (window.key !== 'custom') return null;
  const note = range === 'daily' ? 'Daily chart shows up to the latest 12 dates with activity in this range.' : range === 'weekly' ? 'Bars split recorded activity dates into two groups.' : 'The bar shows the total for the selected range.';
  return <p className="report-chart-note">{note}</p>;
}
