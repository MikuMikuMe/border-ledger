export type Row = Record<string, unknown>;
export type Query = (sql: string) => Promise<Row[]>;
export interface FinancialSnapshot { counts: Record<string, number>; totals: Row[]; foreignKeys: Row[] }
export const baseline: string[];
export const financialTables: string[];
export function sha256(value: string | Uint8Array): string;
export function validHash(value: unknown): boolean;
export function requireGate(condition: unknown, code: string): asserts condition;
export function fingerprint(bindings: Array<{ issuer: string; subject: string; user_id: string }>): string;
export function parseWranglerResults(output: string): Row[];
export function checkSchema(state: unknown): void;
export function checkOwner(state: unknown, expectedHash: unknown, initial?: boolean): void;
export function checkDeployment(state: unknown, target: unknown, mode?: string): void;
export function readState(query: Query): Promise<Record<string, unknown>>;
export function financialSnapshot(query: Query): Promise<FinancialSnapshot>;
export function checkAndroidPublication(state: unknown, target: unknown, health: unknown): void;
