const MAX_DECIMAL_SCALE = 18;

export interface ScaledDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

const POWERS_OF_TEN = Array.from({ length: MAX_DECIMAL_SCALE + 1 }, (_, index) => 10n ** BigInt(index));

export function decimal(value: string, label = 'quantity'): ScaledDecimal {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new RangeError(`Invalid decimal ${label}.`);
  }
  const [integer, fraction = ''] = value.split('.');
  const scale = fraction.length;
  const coefficient = BigInt(`${integer}${fraction}`);
  return normalize({ coefficient, scale });
}

export function normalize(value: ScaledDecimal): ScaledDecimal {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

export function add(left: ScaledDecimal, right: ScaledDecimal): ScaledDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalize({ coefficient: left.coefficient * powerOfTen(scale - left.scale) + right.coefficient * powerOfTen(scale - right.scale), scale });
}

export function subtract(left: ScaledDecimal, right: ScaledDecimal): ScaledDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalize({ coefficient: left.coefficient * powerOfTen(scale - left.scale) - right.coefficient * powerOfTen(scale - right.scale), scale });
}

export function multiply(left: ScaledDecimal, right: ScaledDecimal): ScaledDecimal {
  return normalize({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
}

export function multiplyInteger(left: ScaledDecimal, right: bigint): ScaledDecimal {
  return normalize({ coefficient: left.coefficient * right, scale: left.scale });
}

export function divideInteger(left: ScaledDecimal, right: bigint): ScaledDecimal {
  if (right === 0n) throw new RangeError('Cannot divide by zero.');
  return normalize({ coefficient: left.coefficient / right, scale: left.scale });
}

export function divideExactInteger(left: ScaledDecimal, right: bigint): ScaledDecimal {
  if (right <= 0n) throw new RangeError('Division denominator must be positive.');
  for (let additionalScale = 0; left.scale + additionalScale <= MAX_DECIMAL_SCALE; additionalScale += 1) {
    const numerator = left.coefficient * powerOfTen(additionalScale);
    if (numerator % right === 0n) return normalize({ coefficient: numerator / right, scale: left.scale + additionalScale });
  }
  throw new RangeError('Operation cannot be represented exactly at the supported decimal precision.');
}

export function compare(left: ScaledDecimal, right: ScaledDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const leftCoefficient = left.coefficient * powerOfTen(scale - left.scale);
  const rightCoefficient = right.coefficient * powerOfTen(scale - right.scale);
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;
}

export function isZero(value: ScaledDecimal): boolean {
  return value.coefficient === 0n;
}

export function toString(value: ScaledDecimal): string {
  const normalized = normalize(value);
  if (normalized.scale === 0) return normalized.coefficient.toString();
  const negative = normalized.coefficient < 0n;
  const absolute = (negative ? -normalized.coefficient : normalized.coefficient).toString().padStart(normalized.scale + 1, '0');
  const index = absolute.length - normalized.scale;
  const output = `${absolute.slice(0, index)}.${absolute.slice(index)}`.replace(/0+$/, '').replace(/\.$/, '');
  return negative ? `-${output}` : output;
}

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Ratio denominator must be positive.');
  if (numerator < 0n) return -roundRatio(-numerator, denominator);
  const quotient = numerator / denominator;
  return numerator % denominator * 2n >= denominator ? quotient + 1n : quotient;
}

export function roundedMoney(value: ScaledDecimal): bigint {
  if (value.scale === 0) return value.coefficient;
  return roundRatio(value.coefficient, powerOfTen(value.scale));
}

export function powerOfTen(scale: number): bigint {
  if (!Number.isInteger(scale)) throw new RangeError('Decimal scale is out of range.');
  if (scale < 0) throw new RangeError('Decimal scale is out of range.');
  if (scale > MAX_DECIMAL_SCALE) throw new RangeError('Decimal scale is out of range.');
  return POWERS_OF_TEN[scale];
}

export function exactMoneyTimesQuantity(amountMinor: bigint, quantity: ScaledDecimal): bigint {
  return roundedMoney({ coefficient: amountMinor * quantity.coefficient, scale: quantity.scale });
}

export function safeNumber(value: bigint, label: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || BigInt(numberValue) !== value) throw new RangeError(`${label} exceeds safe integer range.`);
  return numberValue;
}
