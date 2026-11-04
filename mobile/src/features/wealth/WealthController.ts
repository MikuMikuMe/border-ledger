import type { Operation } from '../finance/contracts';
import type { WealthCsvMapping, WealthPorts, WealthReadQuery, WealthView, WealthWireSnapshot } from './contracts';
import { decodeWealthSnapshot } from './model';
import { MutationGate, Resource, errorState } from '../finance/model';

const TERMINAL = new Set(['completed', 'revision_conflict', 'canceled', 'failed_local', 'rejected']);

export type WealthWriteRequest = {
  action: string;
  body: string;
  operationId: string;
};

export type WealthCsvOperationRequest = {
  operationId: string;
};

export type WealthCsvRemapRequest = {
  sourceOperationId: string;
  operationId: string;
  mapping: WealthCsvMapping;
};

export class WealthController {
  readonly state: Resource<WealthWireSnapshot>;
  readonly mutation: MutationGate;
  readonly views: readonly WealthView[] = ['overview', 'investments', 'cash-flow'];
  private subscriptions: { remove(): void }[] = [];
  private disposed = false;
  private query: WealthReadQuery = { view: 'overview' };

  constructor(private readonly ports: WealthPorts, changed: () => void = () => {}) {
    this.state = new Resource<WealthWireSnapshot>(changed);
    this.mutation = new MutationGate(changed);
  }

  async start() {
    this.subscriptions = [this.ports.onChanged(() => { void this.load(); void this.recover(); })];
    await Promise.all([this.recover(), this.load()]);
  }

  async recover() {
    if (!this.disposed) await this.mutation.recover((offset, limit) => this.ports.readOperations(offset, limit));
  }

  async load(query: WealthReadQuery = this.query) {
    this.query = query;
    await this.state.load(async () => decodeWealthSnapshot(await this.ports.read(query)));
  }

  async selectView(view: WealthView) {
    if (!this.views.includes(view)) return;
    await this.load({ ...this.query, view });
  }

  async write({ action, body, operationId }: WealthWriteRequest): Promise<Operation | null> {
    if (this.disposed) return null;
    if (this.mutation.current().status === 'revision_conflict') await this.recover();
    if (this.mutation.current().blocked) return null;
    await this.mutation.submit(operationId, () => this.ports.startWrite(operationId, action, body), id => this.ports.queryOperation(id));
    if (!this.disposed && TERMINAL.has(this.mutation.current().status)) await this.load(this.query);
    return this.ports.queryOperation(operationId);
  }

  async importCsv({ operationId }: WealthCsvOperationRequest): Promise<string | null> {
    if (this.disposed) return null;
    const startCsvImport = this.ports.startCsvImport;
    if (!startCsvImport) return null;
    const readCsvPreview = this.ports.readCsvPreview;
    if (!readCsvPreview) return null;
    await this.mutation.submit(operationId, () => startCsvImport(operationId), id => this.ports.queryOperation(id));
    if (this.disposed) return null;
    const status = this.mutation.current().status;
    if (!TERMINAL.has(status)) return null;
    if (status === 'completed') return readCsvPreview(operationId);
    return null;
  }

  async remapCsv({ sourceOperationId, operationId, mapping }: WealthCsvRemapRequest): Promise<string | null> {
    const startCsvRemap = this.ports.startCsvRemap;
    const readCsvPreview = this.ports.readCsvPreview;
    if (this.disposed) return null;
    if (!startCsvRemap || !readCsvPreview) return null;
    await this.mutation.submit(operationId, () => startCsvRemap(sourceOperationId, operationId, mapping), id => this.ports.queryOperation(id));
    if (this.disposed) return null;
    if (this.mutation.current().status !== 'completed') return null;
    const preview = await readCsvPreview(operationId);
    await this.recover();
    return preview;
  }

  async resumeCsvImport({ operationId }: WealthCsvOperationRequest): Promise<string | null> {
    if (this.disposed || !this.ports.readCsvPreview) return null;
    const operation = await this.ports.queryOperation(operationId);
    if (operation?.status !== 'completed') return null;
    const preview = await this.ports.readCsvPreview(operationId);
    await this.recover();
    return preview;
  }

  async saveCsvTemplate({ operationId }: WealthCsvOperationRequest) {
    if (this.disposed || !this.ports.startCsvTemplate) return;
    await this.mutation.submit(operationId, () => this.ports.startCsvTemplate!(operationId), id => this.ports.queryOperation(id));
  }

  message() {
    const state = this.state.current();
    if (state.phase === 'locked') return 'Renew your owner session to continue.';
    if (state.phase !== 'ready') return state.message ?? '';
    if (state.data?.stale) return 'Showing the last confirmed Wealth report; refresh to check for newer observations.';
    if (state.data?.missingData?.length) return 'Some balances or prices are missing. Add dated values to complete this view.';
    return state.message ?? '';
  }

  dispose() {
    this.disposed = true;
    this.subscriptions.forEach(subscription => subscription.remove());
    this.state.dispose();
  }

  static readableError(error: unknown) {
    return errorState(error).message;
  }
}
