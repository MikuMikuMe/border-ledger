import { useEffect, useState } from 'react';
import { CircleAlert, Download, UploadCloud } from 'lucide-react';
import type { LedgerApi } from '../../domain/api';
import type { WealthAccount } from '../../domain/wealth-types';
import { downloadText, isRecord } from './wealth-utils';
import { writeError } from './wealth-form-shared';

interface ImportPreviewRow {
  rowId: string;
  rowIndex: number;
  recordType: string | null;
  record: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
  error: string | null;
  duplicateOf: string | null;
}

interface ImportPreviewResponse {
  previewId?: string;
  revision?: number;
  rows?: unknown[];
  errors?: unknown[];
  duplicates?: unknown[];
  /** Source columns returned by the server for mapping imported files. */
  headers?: unknown[];
  sourceHeaders?: unknown[];
  canonicalHeaders?: unknown[];
  mapping?: unknown;
}

const IMPORT_MAPPING_FIELDS = [
  'record_type', 'id', 'source_id', 'date', 'kind', 'account_id', 'name', 'account_kind', 'account_mode', 'currency', 'amount_minor', 'active',
  'linked_bank_account_id', 'exchange', 'ticker', 'type', 'quantity', 'basis_minor', 'consideration_minor', 'proceeds_minor', 'fee_minor',
  'numerator', 'denominator', 'from_account_id', 'to_account_id', 'transfer_kind', 'transfer_id', 'target_source_id', 'linked_bank_source_id', 'memo', 'as_of', 'price_minor',
  'source', 'provider', 'sequence', 'event_json',
] as const;

const IMPORT_MAPPING_LABELS: Record<string, string> = {
  record_type: 'Record type', id: 'Record id', source_id: 'Source id', date: 'Event date', kind: 'Event kind', account_id: 'Account', name: 'Name',
  account_kind: 'Account kind', account_mode: 'Account mode', currency: 'Currency', amount_minor: 'Amount (minor units)', active: 'Active',
  linked_bank_account_id: 'Linked bank account', exchange: 'Exchange', ticker: 'Ticker', type: 'Instrument type', quantity: 'Quantity', basis_minor: 'Cost basis (minor units)',
  consideration_minor: 'Consideration (minor units)', proceeds_minor: 'Proceeds (minor units)', fee_minor: 'Fee (minor units)', numerator: 'Split numerator', denominator: 'Split denominator', from_account_id: 'From account', to_account_id: 'To account',
  transfer_kind: 'Transfer kind', transfer_id: 'Transfer id', target_source_id: 'Record to reverse', linked_bank_source_id: 'Activity record', memo: 'Memo', as_of: 'Value date', price_minor: 'Price (minor units)',
  source: 'Source', provider: 'Provider', sequence: 'Sequence', event_json: 'Event details',
};

function serverRowPayload(row: ImportPreviewRow): Record<string, unknown> | null {
  if (row.event) return row.event;
  if (!row.record || !row.recordType) return null;
  const payloadKey = row.recordType === 'mode_transition' ? 'transition' : row.recordType;
  const payload = row.record[payloadKey];
  return isRecord(payload) ? payload : null;
}

function importField(row: ImportPreviewRow, key: string): string {
  const value = serverRowPayload(row)?.[key];
  return value === null || value === undefined ? '—' : typeof value === 'object' ? 'Recorded details' : String(value);
}

function firstImportField(row: ImportPreviewRow, keys: readonly string[]): string {
  for (const key of keys) {
    const value = importField(row, key);
    if (value !== '—') return value;
  }
  return '—';
}

function modeLabel(value: unknown): string | null {
  if (value === 'aggregate') return 'Aggregate value';
  if (value === 'holdings') return 'Holdings + cash';
  return null;
}

function importKindLabel(row: ImportPreviewRow): string {
  if (row.event?.kind) return importField(row, 'kind');
  if (row.recordType === 'mode_transition') return 'Mode transition';
  if (row.recordType === 'account') return 'Account';
  if (row.recordType === 'instrument') return 'Instrument';
  if (row.recordType === 'valuation') return 'Valuation';
  return row.recordType ? 'Record' : '—';
}

function transitionDetails(row: ImportPreviewRow): string {
  const payload = serverRowPayload(row);
  if (!payload) return 'Representation transition';
  const from = modeLabel(payload.fromMode ?? payload.from_mode);
  const to = modeLabel(payload.toMode ?? payload.to_mode);
  const opening = typeof payload.openingCashMinor === 'number'
    ? 'Opening cash included'
    : typeof payload.openingValueMinor === 'number'
      ? 'Opening value recorded'
      : Array.isArray(payload.openingPositions) && payload.openingPositions.length > 0
        ? 'Opening positions included'
        : null;
  return [from && to ? `${from} → ${to}` : 'Representation transition', opening].filter(Boolean).join(' · ');
}

function importDateLabel(row: ImportPreviewRow): string {
  return firstImportField(row, ['date', 'asOf', 'effectiveDate']);
}

function importDetailsLabel(row: ImportPreviewRow): string {
  if (row.recordType === 'mode_transition') return transitionDetails(row);
  return firstImportField(row, ['instrument', 'money', 'name']);
}

function accountName(names: ReadonlyMap<string, string>, id: unknown, fallback = 'Unknown account'): string {
  return typeof id === 'string' ? names.get(id) ?? fallback : fallback;
}

function previewAccountEntry(row: ImportPreviewRow): [string, string] | null {
  if (row.recordType !== 'account') return null;
  const payload = serverRowPayload(row);
  if (!payload) return null;
  const id = payload.id;
  const name = payload.name;
  if (typeof id !== 'string') return null;
  if (typeof name !== 'string' || !name.trim()) return null;
  return [id, name];
}

function previewAccountNames(accounts: readonly WealthAccount[], rows: readonly ImportPreviewRow[]): ReadonlyMap<string, string> {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  rows.flatMap((row) => { const entry = previewAccountEntry(row); return entry ? [entry] : []; }).forEach(([id, name]) => names.set(id, name));
  return names;
}

function importAccountLabel(row: ImportPreviewRow, names: ReadonlyMap<string, string>): string {
  const payload = serverRowPayload(row);
  if (!payload) return '—';
  if (row.recordType === 'account') return typeof payload.name === 'string' ? payload.name : 'New account';
  const accountId = payload.accountId ?? payload.account_id;
  if (typeof accountId === 'string') return accountName(names, accountId);
  const from = payload.fromAccountId ?? payload.from_account_id;
  const to = payload.toAccountId ?? payload.to_account_id;
  return typeof from === 'string' || typeof to === 'string' ? `${accountName(names, from)} → ${accountName(names, to)}` : '—';
}

function importErrors(rows: readonly ImportPreviewRow[], errors: readonly unknown[]): string[] {
  const serverErrors = errors.flatMap((entry) => typeof entry === 'string' ? [entry] : isRecord(entry) && typeof entry.error === 'string' ? [`Row ${String(entry.rowIndex ?? '')}: ${entry.error}`] : []);
  return [...serverErrors, ...rows.flatMap((row) => row.error ? [`Row ${row.rowIndex + 1}: ${row.error}`] : [])];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeImportRow(entry: unknown): ImportPreviewRow | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.rowId !== 'string') return null;
  if (typeof entry.rowIndex !== 'number') return null;
  return { rowId: entry.rowId, rowIndex: entry.rowIndex, recordType: optionalString(entry.recordType), record: optionalRecord(entry.record), event: optionalRecord(entry.event), error: optionalString(entry.error), duplicateOf: optionalString(entry.duplicateOf) };
}

function normalizeImportRows(entries: readonly unknown[]): ImportPreviewRow[] {
  return entries.flatMap((entry) => { const row = normalizeImportRow(entry); return row ? [row] : []; });
}

function normalizedHeader(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseCsvHeader(csv: string): string[] {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? '';
  const fields = /(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g;
  return [...firstLine.matchAll(fields)].map((match) => (match[1] ?? match[2] ?? '').replaceAll('""', '"').trim().toLowerCase()).filter(Boolean);
}

function previewHeaders(preview: ImportPreviewResponse, csv: string): string[] {
  const serverHeaders = [preview.sourceHeaders, preview.headers].find((value) => Array.isArray(value)) as unknown[] | undefined;
  const headers = (serverHeaders ?? parseCsvHeader(csv)).flatMap((value) => { const header = normalizedHeader(value); return header ? [header] : []; });
  return [...new Set(headers)];
}

function previewFields(preview: ImportPreviewResponse): readonly string[] {
  if (!Array.isArray(preview.canonicalHeaders)) return IMPORT_MAPPING_FIELDS;
  const fields = preview.canonicalHeaders.flatMap((value) => { const field = normalizedHeader(value); return field && IMPORT_MAPPING_FIELDS.includes(field as typeof IMPORT_MAPPING_FIELDS[number]) ? [field] : []; });
  return fields.length ? [...new Set(fields)] : IMPORT_MAPPING_FIELDS;
}

function normalizedMapping(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const mapping = isRecord(value.mapping) ? value.mapping : value;
  return Object.fromEntries(Object.entries(mapping).flatMap(([key, candidate]) => {
    const source = normalizedHeader(candidate);
    return IMPORT_MAPPING_FIELDS.includes(key as typeof IMPORT_MAPPING_FIELDS[number]) && source ? [[key, source]] : [];
  }));
}

function autoMapping(headers: readonly string[], existing: Record<string, string>): Record<string, string> {
  const byKey = new Map(headers.map((header) => [header.toLowerCase().replaceAll(' ', '_'), header]));
  return Object.fromEntries(IMPORT_MAPPING_FIELDS.flatMap((field) => {
    const selected = existing[field] ?? byKey.get(field);
    return selected ? [[field, selected]] : [];
  }));
}

function operationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return `wealth-import-${randomUuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function importReadyRowIds(rows: readonly ImportPreviewRow[]): string[] {
  return rows.filter((row) => !row.error && !row.duplicateOf).map((row) => row.rowId);
}

function importDuplicateCount(rows: readonly ImportPreviewRow[], duplicates: readonly unknown[] | undefined): number {
  return (duplicates ?? []).length || rows.filter((row) => row.duplicateOf).length;
}

interface NormalizedImportPreview {
  rows: ImportPreviewRow[];
  errors: string[];
  duplicates: number;
  previewId: string | null;
  revision: number;
  headers: string[];
  mapping: Record<string, string>;
  fields: readonly string[];
  rowIds: string[];
}

function normalizeImportPreview(preview: ImportPreviewResponse, csv: string, fallbackRevision: number): NormalizedImportPreview {
  const rows = normalizeImportRows(preview.rows ?? []);
  const headers = previewHeaders(preview, csv);
  return {
    rows,
    errors: importErrors(rows, preview.errors ?? []),
    duplicates: importDuplicateCount(rows, preview.duplicates),
    previewId: typeof preview.previewId === 'string' ? preview.previewId : null,
    revision: typeof preview.revision === 'number' ? preview.revision : fallbackRevision,
    headers,
    mapping: autoMapping(headers, normalizedMapping(preview.mapping)),
    fields: previewFields(preview),
    rowIds: importReadyRowIds(rows),
  };
}

function importCommitReady(previewId: string | null, errors: readonly string[], rowIds: readonly string[]): boolean {
  return Boolean(previewId) && errors.length === 0 && rowIds.length > 0;
}

function importCommitError(previewId: string | null, errors: readonly string[], rowIds: readonly string[]): string | null {
  if (importCommitReady(previewId, errors, rowIds)) return null;
  return previewId ? 'Resolve import row errors before committing.' : 'Choose a CSV and wait for the server preview before committing.';
}

async function requestImportPreview(api: LedgerApi, csv: string, mapping: Record<string, string>, id: string): Promise<ImportPreviewResponse> {
  const body = { csv, operationId: id, ...(Object.keys(mapping).length ? { mapping } : {}) };
  return await api('/api/wealth/imports/preview', { method: 'POST', body: JSON.stringify(body) }) as ImportPreviewResponse;
}

async function downloadCanonicalTemplate(api: LedgerApi, onNotice: (message: string) => void): Promise<void> {
  try {
    const response = await api('/api/wealth/template?format=json');
    const csv = isRecord(response) && typeof response.csv === 'string' ? response.csv : null;
    if (!csv) throw new Error('The canonical template response was unavailable.');
    downloadText('border-ledger-wealth-template.csv', csv);
  } catch (cause) {
    onNotice(cause instanceof Error ? cause.message : 'The canonical wealth template could not be downloaded.');
  }
}

function ImportErrorNotice({ errors }: { errors: readonly string[] }) {
  return errors.length ? <div className="wealth-import-errors" role="alert"><CircleAlert size={15} /><div>{errors.slice(0, 6).map((error) => <span key={error}>{error}</span>)}</div></div> : null;
}

function ImportMappingControls({ headers, fields, mapping, busy, onChange, onRebuild }: { headers: readonly string[]; fields: readonly string[]; mapping: Readonly<Record<string, string>>; busy: boolean; onChange(field: string, value: string): void; onRebuild(): void }) {
  if (!headers.length) return null;
  return <details className="wealth-import-mapping">
    <summary>Match source columns (optional)</summary>
    <p className="wealth-import-mapping-help">The server uses the canonical names when they are present. Choose a source column only when your file uses a different heading; values are previewed again before import.</p>
    <div className="wealth-import-mapping-grid">
      {fields.map((field) => <label key={field} className="wealth-import-mapping-field"><span>{IMPORT_MAPPING_LABELS[field] ?? field}</span><select value={mapping[field] ?? ''} onChange={(event) => onChange(field, event.target.value)} disabled={busy} aria-label={`Source column for ${IMPORT_MAPPING_LABELS[field] ?? field}`}><option value="">Leave unchanged</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}
    </div>
    <button type="button" className="outline-button" onClick={onRebuild} disabled={busy}>Rebuild server preview</button>
  </details>;
}

function ImportPreviewTable({ rows, accounts }: { rows: readonly ImportPreviewRow[]; accounts: readonly WealthAccount[] }) {
  if (!rows.length) return null;
  const names = previewAccountNames(accounts, rows);
  return <div className="wealth-table-wrap"><table><caption>Server CSV mapping preview</caption><thead><tr><th scope="col">Row</th><th scope="col">Date</th><th scope="col">Kind</th><th scope="col">Account</th><th scope="col">Details</th><th scope="col">Result</th></tr></thead><tbody>{rows.slice(0, 50).map((row) => <tr key={row.rowId}><th scope="row">{row.rowIndex + 1}</th><td>{importDateLabel(row)}</td><td>{importKindLabel(row)}</td><td>{importAccountLabel(row, names)}</td><td>{importDetailsLabel(row)}</td><td>{row.error ? row.error : row.duplicateOf ? 'Duplicate source; skipped' : 'Ready'}</td></tr>)}</tbody></table></div>;
}

function ImportCommitButton({ busy, errors, previewId, rowIds, onCommit }: { busy: boolean; errors: readonly string[]; previewId: string | null; rowIds: readonly string[]; onCommit: () => void }) {
  if (!rowIds.length) return null;
  return <button type="button" className="primary-button" onClick={onCommit} disabled={busy || errors.length > 0 || !previewId}>{busy ? 'Committing…' : `Commit ${rowIds.length} valid rows`}</button>;
}

export function WealthImportPanel({ api, accounts = [], revision: currentRevision, onSaved, onNotice }: { api: LedgerApi; accounts?: readonly WealthAccount[]; revision?: number; onSaved: () => Promise<void>; onNotice(message: string): void }) {
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState(0);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState('');
  const [csvText, setCsvText] = useState('');
  const [sourceHeaders, setSourceHeaders] = useState<string[]>([]);
  const [canonicalFields, setCanonicalFields] = useState<readonly string[]>(IMPORT_MAPPING_FIELDS);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [rowIds, setRowIds] = useState<string[]>([]);

  useEffect(() => { setRevision(currentRevision ?? 0); }, [currentRevision]);

  const parse = async (file: File) => {
    const csv = await file.text();
    const id = operationId();
    setFilename(file.name);
    setCsvText(csv);
    setSourceHeaders([]);
    setCanonicalFields(IMPORT_MAPPING_FIELDS);
    setMapping({});
    setRows([]);
    setErrors([]);
    setDuplicates(0);
    setPreviewId(null);
    setRowIds([]);
    setBusy(true);
    try {
      const preview = await requestImportPreview(api, csv, {}, id);
      const normalized = normalizeImportPreview(preview, csv, currentRevision ?? 0);
      setRows(normalized.rows);
      setErrors(normalized.errors);
      setDuplicates(normalized.duplicates);
      setSourceHeaders(normalized.headers);
      setCanonicalFields(normalized.fields);
      setMapping(normalized.mapping);
      setPreviewId(normalized.previewId);
      setRevision(normalized.revision);
      setRowIds(normalized.rowIds);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'The wealth service could not validate this CSV.']);
    } finally {
      setBusy(false);
    }
  };

  const rebuildPreview = async () => {
    if (!csvText) {
      onNotice('Choose a CSV before rebuilding its preview.');
      return;
    }
    const id = operationId();
    setBusy(true);
    setRows([]);
    setErrors([]);
    setDuplicates(0);
    setPreviewId(null);
    setRowIds([]);
    try {
      const preview = await requestImportPreview(api, csvText, mapping, id);
      const normalized = normalizeImportPreview(preview, csvText, revision || currentRevision || 0);
      setRows(normalized.rows);
      setErrors(normalized.errors);
      setDuplicates(normalized.duplicates);
      setSourceHeaders(normalized.headers);
      setCanonicalFields(normalized.fields);
      setMapping(normalized.mapping);
      setPreviewId(normalized.previewId);
      setRevision(normalized.revision);
      setRowIds(normalized.rowIds);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'The wealth service could not rebuild this CSV preview.']);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    const validationError = importCommitError(previewId, errors, rowIds);
    if (validationError) {
      onNotice(validationError);
      return;
    }
    if (previewId === null) {
      onNotice('Choose a CSV and wait for the server preview before committing.');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/wealth/imports/${encodeURIComponent(previewId)}/commit`, { method: 'POST', body: JSON.stringify({ expectedRevision: revision, rowIds }) });
      setRows([]);
      setFilename('');
      setCsvText('');
      setSourceHeaders([]);
      setCanonicalFields(IMPORT_MAPPING_FIELDS);
      setMapping({});
      setPreviewId(null);
      setRowIds([]);
      onNotice('Wealth import committed; duplicate source rows were skipped.');
      await onSaved();
    } catch (cause) {
      onNotice(writeError(cause, 'The import could not be committed.'));
    } finally {
      setBusy(false);
    }
  };

  return <section className="wealth-import-panel" aria-labelledby="wealth-import-title">
    <div className="wealth-section-heading"><div><h3 id="wealth-import-title">CSV activity import</h3><p>Download the template, let the server map and validate the file, then preview errors and duplicates before committing.</p></div><UploadCloud size={18} aria-hidden="true" /></div>
    <div className="wealth-import-actions"><button type="button" className="outline-button" onClick={() => { void downloadCanonicalTemplate(api, onNotice); }} disabled={busy}><Download size={15} /> Download CSV template</button><label className="wealth-file-button"><UploadCloud size={15} /> Choose CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ''; if (file) void parse(file); }} /></label></div>
    {filename ? <p className="wealth-import-file"><strong>{filename}</strong> · {rows.length} server rows previewed · {duplicates} duplicates</p> : null}
    <ImportErrorNotice errors={errors} />
    <ImportMappingControls headers={sourceHeaders} fields={canonicalFields} mapping={mapping} busy={busy} onChange={(field, value) => setMapping((current) => value ? { ...current, [field]: value } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)))} onRebuild={() => { void rebuildPreview(); }} />
    <ImportPreviewTable rows={rows} accounts={accounts} />
    <ImportCommitButton busy={busy} errors={errors} previewId={previewId} rowIds={rowIds} onCommit={() => { void commit(); }} />
  </section>;
}
