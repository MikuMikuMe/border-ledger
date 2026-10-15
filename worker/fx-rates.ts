import { currencyRegistry, getCurrencyMeta, type CurrencyMeta, type CurrencyRegistry } from '../src/domain/currencies';

const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.dev/v2/rates';
const FRANKFURTER_PROVIDER = 'frankfurter' as const;
const MAX_PROVIDER_BODY_BYTES = 64 * 1024;
const MAX_RATE_ROWS = 256;
const MAX_DECIMAL_TEXT_LENGTH = 128;
const MAX_DECIMAL_EXPONENT = 512;
const REQUEST_TIMEOUT_MS = 10_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_JSON_DEPTH = 8;
const MAX_JSON_VALUES = MAX_RATE_ROWS * 12;

export type ValidatedRateMap = Readonly<Record<string, string>>;

export interface ValidatedFxRates {
  effectiveDate: string;
  rates: ValidatedRateMap;
}

export interface FxProviderSnapshot extends ValidatedFxRates {
  provider: typeof FRANKFURTER_PROVIDER;
  requestedDate: string;
}

/**
 * The primary fields are sourceCurrency, targetCurrency, and rates. The
 * metadata aliases keep this boundary usable by callers that already carry
 * CurrencyMeta objects, while the implementation still validates every code
 * against the shared registry.
 */
export interface FxConversionInput {
  amountMinorUnits: number;
  sourceCurrency?: string | CurrencyMeta;
  targetCurrency?: string | CurrencyMeta;
  sourceCode?: string;
  targetCode?: string;
  source?: string | CurrencyMeta;
  target?: string | CurrencyMeta;
  rates?: ValidatedFxRates | FxProviderSnapshot | ValidatedRateMap | ReadonlyMap<string, string>;
  snapshot?: ValidatedFxRates | FxProviderSnapshot;
  rateSnapshot?: ValidatedFxRates | FxProviderSnapshot;
  sourceMinorUnitDigits?: number;
  targetMinorUnitDigits?: number;
  sourceMeta?: CurrencyMeta;
  targetMeta?: CurrencyMeta;
  sourceCurrencyMeta?: CurrencyMeta;
  targetCurrencyMeta?: CurrencyMeta;
  minorUnitDigits?: { source: number; target: number };
}

interface DecimalRational {
  numerator: bigint;
  denominator: bigint;
}

interface CurrencyDescriptor {
  code: string;
  minorUnitDigits?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type FxErrorKind = 'invalid_rates' | 'response_too_large' | 'empty_response' | 'malformed_response' | 'timeout' | 'provider_request';

export class FxProviderError extends Error {
  constructor(readonly kind: FxErrorKind, message: string) {
    super(message);
    this.name = 'FxProviderError';
  }
}

export function isFxProviderError(value: unknown): value is FxProviderError {
  return value instanceof FxProviderError;
}

function invalidRates(): never {
  throw new FxProviderError('invalid_rates', 'The Frankfurter rates payload is not valid.');
}

function isJsonWhitespace(value: string) {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t';
}

class LosslessJsonParser {
  private index = 0;
  private valueCount = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail();
    return value;
  }

  private fail(): never {
    throw new FxProviderError('malformed_response', 'The Frankfurter response is malformed.');
  }

  private skipWhitespace() {
    while (this.index < this.text.length && isJsonWhitespace(this.text[this.index])) this.index += 1;
  }

  private parseValue(depth: number): unknown {
    this.valueCount += 1;
    if (depth > MAX_JSON_DEPTH || this.valueCount > MAX_JSON_VALUES) this.fail();
    this.skipWhitespace();
    const current = this.text[this.index];
    if (current === '{') return this.parseObject(depth + 1);
    if (current === '[') return this.parseArray(depth + 1);
    if (current === '"') return this.parseString();
    if (current === 't') return this.parseLiteral('true', true);
    if (current === 'f') return this.parseLiteral('false', false);
    if (current === 'n') return this.parseLiteral('null', null);
    if (current === '-' || /\d/.test(current ?? '')) return this.parseNumberToken();
    return this.fail();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    this.skipWhitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') return this.fail();
      const key = this.parseString();
      if (Object.prototype.hasOwnProperty.call(result, key)) return this.fail();
      this.skipWhitespace();
      if (this.text[this.index] !== ':') return this.fail();
      this.index += 1;
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') return this.fail();
      this.index += 1;
    }
    return this.fail();
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') return this.fail();
      this.index += 1;
    }
    return this.fail();
  }

  private parseLiteral(literal: string, value: boolean | null) {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) return this.fail();
    this.index += literal.length;
    return value;
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        try {
          const value = JSON.parse(this.text.slice(start, this.index)) as unknown;
          if (typeof value !== 'string') return this.fail();
          return value;
        } catch {
          return this.fail();
        }
      }
      if (code < 0x20) return this.fail();
      if (code === 0x5c) {
        this.index += 1;
        const escaped = this.text[this.index];
        if (escaped === 'u') {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return this.fail();
          this.index += 5;
        } else if ('"\\/bfnrt'.includes(escaped ?? '')) {
          this.index += 1;
        } else {
          return this.fail();
        }
      } else {
        this.index += 1;
      }
    }
    return this.fail();
  }

  private parseNumberToken(): string {
    const start = this.index;
    if (this.text[this.index] === '-') this.index += 1;
    if (this.text[this.index] === '0') {
      this.index += 1;
      if (/\d/.test(this.text[this.index] ?? '')) return this.fail();
    } else {
      if (!/[1-9]/.test(this.text[this.index] ?? '')) return this.fail();
      while (/\d/.test(this.text[this.index] ?? '')) this.index += 1;
    }
    if (this.text[this.index] === '.') {
      this.index += 1;
      if (!/\d/.test(this.text[this.index] ?? '')) return this.fail();
      while (/\d/.test(this.text[this.index] ?? '')) this.index += 1;
    }
    if (this.text[this.index] === 'e' || this.text[this.index] === 'E') {
      this.index += 1;
      if (this.text[this.index] === '+' || this.text[this.index] === '-') this.index += 1;
      if (!/\d/.test(this.text[this.index] ?? '')) return this.fail();
      while (/\d/.test(this.text[this.index] ?? '')) this.index += 1;
    }
    return this.text.slice(start, this.index);
  }
}

function parseLosslessJson(text: string): unknown {
  return new LosslessJsonParser(text).parse();
}

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isSupportedFxDate(value: string): boolean {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function decimalText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DECIMAL_TEXT_LENGTH) return null;
  return value;
}

function parsePositiveDecimal(value: unknown): { rational: DecimalRational; canonical: string } | null {
  const text = decimalText(value);
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;

  const integerPart = match[1];
  const fractionPart = match[2] ?? '';
  const exponentText = match[3] ?? '0';
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;

  const digitsText = `${integerPart}${fractionPart}`.replace(/^0+/, '');
  if (digitsText.length === 0) return null;
  const rawScale = fractionPart.length - exponent;
  if (Math.abs(rawScale) > MAX_DECIMAL_EXPONENT) return null;

  let numerator = BigInt(digitsText);
  let denominator = 1n;
  if (rawScale > 0) denominator = 10n ** BigInt(rawScale);
  if (rawScale < 0) numerator *= 10n ** BigInt(-rawScale);

  const canonicalDigits = digitsText;
  let canonical: string;
  if (rawScale <= 0) {
    canonical = `${canonicalDigits}${'0'.repeat(-rawScale)}`;
  } else if (canonicalDigits.length > rawScale) {
    const split = canonicalDigits.length - rawScale;
    canonical = `${canonicalDigits.slice(0, split)}.${canonicalDigits.slice(split)}`;
  } else {
    canonical = `0.${'0'.repeat(rawScale - canonicalDigits.length)}${canonicalDigits}`;
  }
  if (canonical.includes('.')) canonical = canonical.replace(/0+$/, '').replace(/\.$/, '');
  if (canonical.startsWith('.')) canonical = `0${canonical}`;

  return { rational: { numerator, denominator }, canonical };
}

function readPayloadRow(row: unknown): { date: string; base: string; quote: string; rate: unknown } {
  if (!isRecord(row) || typeof row.date !== 'string' || typeof row.base !== 'string' || typeof row.quote !== 'string' || !('rate' in row)) {
    return invalidRates();
  }
  if (row.date.length > 10 || row.base.length > 3 || row.quote.length > 3) return invalidRates();
  return { date: row.date, base: row.base, quote: row.quote, rate: row.rate };
}

export function parseFrankfurterRates(payload: unknown): ValidatedFxRates {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > MAX_RATE_ROWS) return invalidRates();

  let effectiveDate: string | null = null;
  const rates: Record<string, string> = {};
  for (const candidate of payload) {
    const row = readPayloadRow(candidate);
    if (!isSupportedFxDate(row.date) || row.base !== 'EUR' || row.quote === 'EUR' || !CURRENCY_CODE_PATTERN.test(row.quote) || !getCurrencyMeta(row.quote)) {
      return invalidRates();
    }
    if (effectiveDate === null) effectiveDate = row.date;
    if (effectiveDate !== row.date || Object.prototype.hasOwnProperty.call(rates, row.quote)) return invalidRates();

    const parsedRate = parsePositiveDecimal(row.rate);
    if (!parsedRate) return invalidRates();
    rates[row.quote] = parsedRate.canonical;
  }

  if (!effectiveDate) return invalidRates();
  return { effectiveDate, rates };
}

function descriptor(value: unknown): CurrencyDescriptor | null {
  if (typeof value === 'string') return { code: value };
  if (!isRecord(value) || typeof value.code !== 'string') return null;
  return {
    code: value.code,
    minorUnitDigits: typeof value.minorUnitDigits === 'number' ? value.minorUnitDigits : undefined,
  };
}

function rateMap(value: unknown): Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null {
  if (value instanceof Map) return value;
  if (!isRecord(value)) return null;
  if (isRecord(value.rates) || value.rates instanceof Map) return rateMap(value.rates);
  if (isRecord(value.quotes) || value.quotes instanceof Map) return rateMap(value.quotes);
  return value;
}

function rateValue(map: Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown>, code: string): unknown {
  if (typeof (map as ReadonlyMap<string, unknown>).get === 'function') return (map as ReadonlyMap<string, unknown>).get(code);
  const objectMap = map as Readonly<Record<string, unknown>>;
  return Object.prototype.hasOwnProperty.call(objectMap, code) ? objectMap[code] : undefined;
}

function suppliedDigits(input: FxConversionInput, side: 'source' | 'target', descriptorValue: CurrencyDescriptor) {
  const explicit = side === 'source'
    ? input.sourceMinorUnitDigits ?? input.sourceMeta?.minorUnitDigits ?? input.sourceCurrencyMeta?.minorUnitDigits ?? input.minorUnitDigits?.source ?? descriptorValue.minorUnitDigits
    : input.targetMinorUnitDigits ?? input.targetMeta?.minorUnitDigits ?? input.targetCurrencyMeta?.minorUnitDigits ?? input.minorUnitDigits?.target ?? descriptorValue.minorUnitDigits;
  return explicit;
}

function validatedDigits(code: string, explicit: number | undefined, registry: CurrencyRegistry): number | null {
  const metadata = getCurrencyMeta(code, registry);
  if (!metadata || (explicit !== undefined && (explicit !== metadata.minorUnitDigits || !Number.isInteger(explicit)))) return null;
  return metadata.minorUnitDigits;
}

function oneUnit(): DecimalRational {
  return { numerator: 1n, denominator: 1n };
}

function requiredRate(map: Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown> | null, code: string): DecimalRational | null {
  if (!map) return null;
  const parsed = parsePositiveDecimal(rateValue(map, code));
  return parsed?.rational ?? null;
}

export function convertMinorUnits(input: FxConversionInput): number | null {
  if (!input || !Number.isSafeInteger(input.amountMinorUnits)) return null;

  const source = descriptor(input.sourceCurrency ?? input.sourceCode ?? input.source);
  const target = descriptor(input.targetCurrency ?? input.targetCode ?? input.target);
  if (!source || !target) return null;

  const sourceDigits = validatedDigits(source.code, suppliedDigits(input, 'source', source), currencyRegistry);
  const targetDigits = validatedDigits(target.code, suppliedDigits(input, 'target', target), currencyRegistry);
  if (sourceDigits === null || targetDigits === null) return null;

  if (source.code === target.code) return input.amountMinorUnits;

  const map = rateMap(input.rates ?? input.snapshot ?? input.rateSnapshot);
  const sourceRate = source.code === 'EUR' ? oneUnit() : requiredRate(map, source.code);
  const targetRate = target.code === 'EUR' ? oneUnit() : requiredRate(map, target.code);
  if (!sourceRate || !targetRate) return null;

  const magnitude = BigInt(Math.abs(input.amountMinorUnits));
  const sourceScale = 10n ** BigInt(sourceDigits);
  const targetScale = 10n ** BigInt(targetDigits);
  const numerator = magnitude * targetScale * targetRate.numerator * sourceRate.denominator;
  const denominator = sourceScale * targetRate.denominator * sourceRate.numerator;
  if (denominator <= 0n) return null;

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedMagnitude = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  const signed = input.amountMinorUnits < 0 ? -roundedMagnitude : roundedMagnitude;
  if (signed > MAX_SAFE_INTEGER_BIGINT || signed < MIN_SAFE_INTEGER_BIGINT) return null;
  return Number(signed);
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_PROVIDER_BODY_BYTES) {
    throw new FxProviderError('response_too_large', 'The Frankfurter response is too large.');
  }

  if (signal.aborted) throw new FxProviderError('timeout', 'The Frankfurter request timed out.');
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_BODY_BYTES) throw new FxProviderError('response_too_large', 'The Frankfurter response is too large.');
    return text;
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      if (signal.aborted) throw new FxProviderError('timeout', 'The Frankfurter request timed out.');
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_PROVIDER_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FxProviderError('response_too_large', 'The Frankfurter response is too large.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchFrankfurterSnapshot(requestedDate: string, fetcher: typeof fetch = fetch): Promise<FxProviderSnapshot> {
  if (!isSupportedFxDate(requestedDate)) throw new RangeError('The requested FX date is not valid.');

  const endpoint = `${FRANKFURTER_ENDPOINT}?date=${requestedDate}&base=EUR`;
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new FxProviderError('timeout', 'The Frankfurter request timed out.'));
    }, REQUEST_TIMEOUT_MS);
  });

  const operation = (async () => {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response || response.ok === false || (typeof response.status === 'number' && (response.status < 200 || response.status >= 300))) {
      throw new FxProviderError('provider_request', 'The Frankfurter provider request failed.');
    }
    const text = await readBoundedBody(response, controller.signal);
    if (text.trim().length === 0) throw new FxProviderError('empty_response', 'The Frankfurter response is empty.');
    const payload = parseLosslessJson(text);
    const parsed = parseFrankfurterRates(payload);
    return {
      provider: FRANKFURTER_PROVIDER,
      requestedDate,
      effectiveDate: parsed.effectiveDate,
      rates: parsed.rates,
    } satisfies FxProviderSnapshot;
  })();

  try {
    return await Promise.race([operation, timeoutPromise]);
  } catch (error) {
    if (timedOut || (error instanceof FxProviderError && error.kind === 'timeout')) {
      throw new FxProviderError('timeout', 'The Frankfurter request timed out.');
    }
    if (error instanceof FxProviderError) throw error;
    throw new FxProviderError('provider_request', 'The Frankfurter provider request failed.');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
