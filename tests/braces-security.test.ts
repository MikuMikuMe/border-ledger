import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const braces = createRequire(import.meta.url)('../mobile/vendor/braces') as {
  (pattern: string): unknown;
  expand(pattern: string): unknown;
};

const maximumBraceDepth = 100;
const deeplyNestedPattern = `${'{'.repeat(maximumBraceDepth + 1)}value${'}'.repeat(maximumBraceDepth + 1)}`;
const patternAtMaximumDepth = `${'{'.repeat(maximumBraceDepth)}value${'}'.repeat(maximumBraceDepth)}`;
const expectedDepthError = `Input nesting depth exceeds max (${maximumBraceDepth})`;

describe('braces dependency hardening', () => {
  it('allows patterns at the configured nesting limit', () => {
    expect(() => braces(patternAtMaximumDepth)).not.toThrow();
    expect(() => braces.expand(patternAtMaximumDepth)).not.toThrow();
  });

  it('rejects excessive nesting before compile recursion', () => {
    expect(() => braces(deeplyNestedPattern)).toThrow(expectedDepthError);
  });

  it('rejects excessive nesting before expansion recursion', () => {
    expect(() => braces.expand(deeplyNestedPattern)).toThrow(expectedDepthError);
  });
});
