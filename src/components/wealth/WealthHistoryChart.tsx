import { useMemo, type CSSProperties } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { WealthCurrency } from '../../domain/wealth-types';
import { formatWealthMoney } from './wealth-utils';
import type { WealthHistoryPoint } from './wealth-utils';

interface WealthHistoryChartProps {
  history: WealthHistoryPoint[];
  showCadEstimate: boolean;
  preferredCurrency: WealthCurrency | null;
}

interface BarGeometryInput {
  amount: number | null;
  maximum: number;
  signed: boolean;
}

interface BarClassInput extends BarGeometryInput {
  point: WealthHistoryPoint;
}

interface HistoryQuery {
  history: WealthHistoryPoint[];
  showCadEstimate: boolean;
  currency: string;
}

interface ChartLabelInput {
  title: string;
  hasIncomplete: boolean;
  hasNegative: boolean;
}

interface ChartNoteInput {
  showCadEstimate: boolean;
  currency: string;
  allComplete: boolean;
  hasNegative: boolean;
}

interface ChartNoteCopy {
  lane: string;
  status: string;
}

function label(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(parsed);
}

function historyCurrencies(history: WealthHistoryPoint[]): string[] {
  return [...new Set(history.flatMap((point) => Object.keys(point.totals)))].sort((left, right) => left === 'CAD' ? -1 : right === 'CAD' ? 1 : left.localeCompare(right));
}

function historyMaximum(history: WealthHistoryPoint[], showCadEstimate: boolean, currency: string): number {
  const values = showCadEstimate ? history.map((point) => point.convertedCadMinor).filter((value): value is number => value !== null) : history.map((point) => point.totals[currency]).filter((value): value is number => value !== undefined);
  return Math.max(...values.map((value) => Math.abs(value)), 1);
}

function historyAmount(point: WealthHistoryPoint, showCadEstimate: boolean, currency: string): number | null {
  return showCadEstimate ? point.convertedCadMinor : point.totals[currency] ?? null;
}

function coverageLabel(point: WealthHistoryPoint): string {
  if (!point.complete) {
    const missingCount = point.missingData.length;
    const missingLabel = missingCount ? ` · ${missingCount} dated observation${missingCount === 1 ? '' : 's'} missing` : '';
    return `Incomplete · known subtotal${missingLabel}`;
  }
  return point.stale ? 'Stale observation' : 'Complete';
}

function historyBarHeight({ amount, maximum, signed }: BarGeometryInput): number {
  if (amount === null) return 0;
  const scale = signed ? 50 : 100;
  return Math.max(4, Math.round((Math.abs(amount) / maximum) * scale));
}

function historyBarDirection({ amount, signed }: Pick<BarGeometryInput, 'amount' | 'signed'>): string {
  if (!signed) return '';
  if (amount === null) return '';
  if (amount >= 0) return '';
  return 'is-negative';
}

function historyBarClasses({ point, amount, signed }: BarClassInput): string {
  const classes = ['wealth-history-bar'];
  if (!point.complete) classes.push('is-incomplete');
  const direction = historyBarDirection({ amount, signed });
  if (direction) classes.push(direction);
  if (amount === null) classes.push('is-unavailable');
  return classes.join(' ');
}

function historyBarStyle({ amount, height, signed }: { amount: number | null; height: number; signed: boolean }): CSSProperties {
  if (!signed) return { height: `${height}%` };
  return amount !== null && amount < 0 ? { height: `${height}%`, top: '50%' } : { height: `${height}%`, bottom: '50%' };
}

function HistoryBar({ point, showCadEstimate, barCurrency, maximum, signed }: { point: WealthHistoryPoint; showCadEstimate: boolean; barCurrency: string; maximum: number; signed: boolean }) {
  const amount = historyAmount(point, showCadEstimate, barCurrency);
  const geometry = { amount, maximum, signed };
  const height = historyBarHeight(geometry);
  const classes = historyBarClasses({ point, ...geometry });
  const style = historyBarStyle({ amount, height, signed });
  return <div className="wealth-history-column"><div className={`wealth-history-track${signed ? ' is-signed' : ''}`}><span className={classes} style={style} aria-hidden="true" /></div><span className="wealth-history-date">{label(point.date)}</span></div>;
}

function HistoryBars({ history, showCadEstimate, barCurrency, maximum, signed }: { history: WealthHistoryPoint[]; showCadEstimate: boolean; barCurrency: string; maximum: number; signed: boolean }) {
  return <div className="wealth-history-bars">{history.map((point) => <HistoryBar key={point.date} point={point} showCadEstimate={showCadEstimate} barCurrency={barCurrency} maximum={maximum} signed={signed} />)}</div>;
}

function HistoryDataTable({ history, showCadEstimate, currencies, title }: { history: WealthHistoryPoint[]; showCadEstimate: boolean; currencies: string[]; title: string }) {
  return <details className="wealth-data-details"><summary>View history data table</summary><div className="wealth-table-wrap"><table aria-label="Net worth history"><caption>{title}; values are dated observations and never backfilled.</caption><thead><tr><th scope="col">Date</th>{showCadEstimate ? <th scope="col">CAD estimate</th> : currencies.map((currency) => <th scope="col" key={currency}>{currency}</th>)}<th scope="col">Coverage</th></tr></thead><tbody>{history.map((point) => <tr key={point.date}><th scope="row">{label(point.date)}</th>{showCadEstimate ? <td>{formatWealthMoney(point.convertedCadMinor, 'CAD')}</td> : currencies.map((currency) => <td key={currency}>{formatWealthMoney(point.totals[currency], currency)}</td>)}<td>{coverageLabel(point)}</td></tr>)}</tbody></table></div></details>;
}

function historyHasNegative({ history, showCadEstimate, currency }: HistoryQuery): boolean {
  return history.some((point) => { const amount = historyAmount(point, showCadEstimate, currency); return amount !== null && amount < 0; });
}

function chartTitle({ showCadEstimate, currency }: Pick<HistoryQuery, 'showCadEstimate' | 'currency'>): string {
  return showCadEstimate ? 'Dated net worth estimates in Canadian dollars' : `Dated net worth in ${currency}; the table keeps every source currency`;
}

function chartLabel({ title, hasIncomplete, hasNegative }: ChartLabelInput): string {
  const notes = [title];
  if (hasIncomplete) notes.push('Some points are incomplete known subtotals; open the history data table for coverage.');
  if (hasNegative) notes.push('Negative values extend below zero.');
  return notes.join(' ');
}

function chartNote({ showCadEstimate, currency, allComplete, hasNegative }: ChartNoteInput): ChartNoteCopy {
  const lane = showCadEstimate ? 'server-converted CAD' : `${currency} source`;
  const coverage = allComplete ? '' : ' Patterned bars mark incomplete points; values are known subtotals.';
  const sign = hasNegative ? ' Negative values extend below zero.' : '';
  return { lane, status: `${coverage}${sign}` };
}

export function WealthHistoryChart({ history, showCadEstimate, preferredCurrency }: WealthHistoryChartProps) {
  const currencies = useMemo(() => historyCurrencies(history), [history]);
  const barCurrency = preferredCurrency && currencies.includes(preferredCurrency) ? preferredCurrency : currencies[0] ?? 'CAD';
  const maximum = historyMaximum(history, showCadEstimate, barCurrency);
  const title = chartTitle({ showCadEstimate, currency: barCurrency });
  const hasIncomplete = history.some((point) => !point.complete);
  const hasNegative = historyHasNegative({ history, showCadEstimate, currency: barCurrency });
  const accessibleLabel = chartLabel({ title, hasIncomplete, hasNegative });
  const note = chartNote({ showCadEstimate, currency: barCurrency, allComplete: !hasIncomplete, hasNegative });
  if (history.length === 0) return <div className="wealth-empty-copy"><strong>No dated net worth history yet.</strong><span>Save an account value or valuation to build this timeline. Unknown history is left unavailable.</span></div>;
  return <><div className="wealth-history-chart" role="img" aria-label={accessibleLabel}><div className="wealth-history-axis" aria-hidden="true"><span>{formatWealthMoney(maximum, showCadEstimate ? 'CAD' : currencies[0] ?? 'CAD')}</span><span>midpoint</span><span>zero</span></div><HistoryBars history={history} showCadEstimate={showCadEstimate} barCurrency={barCurrency} maximum={maximum} signed={hasNegative} /></div><HistoryDataTable history={history} showCadEstimate={showCadEstimate} currencies={currencies} title={title} /><p className="wealth-chart-note"><ArrowUpRight size={14} /> Bars show the {note.lane} lane. <ArrowDownRight size={14} /> Other currencies and debt direction stay visible in the table.{note.status}</p></>;
}
