import type { Query } from './hosted-users-gate.mjs';
export function runWrangler(args: string[]): string;
export function queryAdapter(target: unknown, run?: (args: string[]) => string): Query;
export function main(args?: string[]): Promise<void>;
