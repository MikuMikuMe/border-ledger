import { describe, expect, it } from 'vitest';
import { allocateTransfer } from '../src/domain/budget-transfer';

describe('category funding transfers', () => {
  it('moves funds without changing the total allocated', () => {
    expect(allocateTransfer({fromMinor:5000,toMinor:1000,amountMinor:2000})).toEqual({fromMinor:3000,toMinor:3000});
  });
  it('keeps overdrawn funding visible', () => {
    expect(allocateTransfer({fromMinor:500,toMinor:1000,amountMinor:2000})).toEqual({fromMinor:-1500,toMinor:3000});
  });
  it('rejects invalid amounts and overflow', () => {
    expect(() => allocateTransfer({fromMinor:0,toMinor:0,amountMinor:0})).toThrow();
    expect(() => allocateTransfer({fromMinor:0,toMinor:0,amountMinor:0.1})).toThrow();
    expect(() => allocateTransfer({fromMinor:0,toMinor:Number.MAX_SAFE_INTEGER,amountMinor:1})).toThrow();
  });
});
