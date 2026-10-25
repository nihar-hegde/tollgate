// Money helpers. Inside Tollgate, money is a bigint count of USDC base units;
// dollar strings ("0.01") only appear at the edges (requests, verdicts, UI).

// USDC has 6 decimals: $1 = 1_000_000 base units.
export const USDC_DECIMALS = 6;
const UNITS_PER_DOLLAR = 10n ** BigInt(USDC_DECIMALS);

// Whole dollars without leading zeros, then optionally a dot and digits.
// The decimal count is checked separately so the error can say why.
const DOLLARS = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function invalidAmount(input: string, reason: string): Error {
  return new Error(`invalid amount ${JSON.stringify(input)}: ${reason}`);
}

/**
 * Converts a dollar string to USDC base units: "0.01" → 10000n.
 * Parses the string exactly, never via floats. Throws unless the input is a
 * positive amount with at most 6 decimals.
 */
export function toBaseUnits(dollars: string): bigint {
  const match = DOLLARS.exec(dollars);
  if (!match) {
    throw invalidAmount(dollars, "expected digits with an optional decimal part, like 0.01");
  }

  // The regex guarantees `whole` is present; `fraction` is missing for "5".
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > USDC_DECIMALS) {
    throw invalidAmount(dollars, `more than ${USDC_DECIMALS} decimals`);
  }

  // "2.5" → "2" + "500000" → 2500000n
  const units = BigInt(whole + fraction.padEnd(USDC_DECIMALS, "0"));
  if (units === 0n) {
    throw invalidAmount(dollars, "must be greater than zero");
  }
  return units;
}

/**
 * Converts USDC base units to a dollar string: 10000n → "0.01".
 * Always at least 2 decimals; more only when needed ("1.2345", "0.000001").
 */
export function fromBaseUnits(units: bigint): string {
  if (units < 0n) {
    throw invalidAmount(units.toString(), "must not be negative");
  }

  const whole = units / UNITS_PER_DOLLAR;
  const fraction = (units % UNITS_PER_DOLLAR)
    .toString()
    .padStart(USDC_DECIMALS, "0") // 10000n → "010000"
    .replace(/0+$/, "") // → "01"
    .padEnd(2, "0"); // → "01" (only pads "", "5" and the like)
  return `${whole}.${fraction}`;
}
