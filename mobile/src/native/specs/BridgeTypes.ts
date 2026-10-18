/** IDs are opaque native operation references. Amounts are base-10 minor-unit strings. */
export type Operation = {operationId: string; kind: string; status: string; updatedAt: string; resultId: string | null};
export type Change = {sequence: number; observedAt: string};
export type Money = {currency: string; amountMinor: string};
export type PageQuery = {cursor: string | null; limit: number};
