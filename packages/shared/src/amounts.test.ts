// Acceptance tests for the money helpers.
// Money inside Tollgate is a bigint count of USDC base units (6 decimals):
// $1 = 1_000_000n, $0.01 = 10_000n. Dollar strings only appear at the edges.

import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "./amounts";

// Rejections must throw our own error, not a crash. Requiring the word
// "amount" in the message stops a TypeError (e.g. a missing function)
// from passing these tests by accident.
const OUR_ERROR = /amount/i;

it("exports both helpers as functions", () => {
  expect(typeof toBaseUnits).toBe("function");
  expect(typeof fromBaseUnits).toBe("function");
});

describe("toBaseUnits", () => {
  // it.each runs the same test once per row: [input, expected].
  it.each([
    ["0.01", 10_000n], // one cent: the price of one Tollgate API call
    ["5", 5_000_000n], // whole dollars, no decimal point
    ["0.1", 100_000n],
    ["0.10", 100_000n], // same value as "0.1": trailing zeros don't change it
    ["2.50", 2_500_000n],
    ["0.000001", 1n], // the smallest possible amount (6 decimals)
    ["1234567.891011", 1_234_567_891_011n], // large amounts stay exact
    ["9007199254740993", 9_007_199_254_740_993_000_000n], // beyond Number.MAX_SAFE_INTEGER
  ])("converts %s dollars to %s base units", (dollars, expected) => {
    expect(toBaseUnits(dollars)).toBe(expected);
  });

  it("returns a bigint, not a number", () => {
    expect(typeof toBaseUnits("1")).toBe("bigint");
  });

  it.each([
    ["0.0000001", "more than 6 decimals"],
    ["1.1234567", "more than 6 decimals"],
    ["0", "zero"],
    ["0.00", "zero"],
    ["0.000000", "zero"],
    ["-1", "negative"],
    ["-0.01", "negative"],
    ["+1", "plus sign"],
    ["1e-2", "scientific notation"],
    ["1E2", "scientific notation"],
    [".5", "no digit before the dot"],
    ["1.", "no digit after the dot"],
    ["", "empty"],
    [" 1", "leading space"],
    ["1 ", "trailing space"],
    ["1,000", "comma"],
    ["1.2.3", "two dots"],
    ["abc", "not a number"],
    ["$1", "currency symbol"],
    ["NaN", "not a number"],
    ["Infinity", "not a number"],
    ["01", "leading zero"],
    ["00.5", "leading zero"],
  ])("rejects %j (%s)", (dollars) => {
    expect(() => toBaseUnits(dollars)).toThrow(OUR_ERROR);
  });
});

describe("toBaseUnits error messages", () => {
  // The message is what ends up in logs and API responses, so it should say
  // what was wrong, not just "invalid".
  it.each([
    ["1.1234567", /more than 6 decimals/],
    ["0.00", /greater than zero/],
    ["1e-2", /like 0\.01/],
  ])("explains why %j was rejected", (dollars, reason) => {
    expect(() => toBaseUnits(dollars)).toThrow(reason);
  });

  it("includes the rejected input", () => {
    expect(() => toBaseUnits("1e-2")).toThrow('invalid amount "1e-2"');
  });
});

describe("fromBaseUnits", () => {
  it.each([
    [10_000n, "0.01"],
    [5_000_000n, "5.00"], // always at least 2 decimals
    [2_500_000n, "2.50"],
    [1_234_500n, "1.2345"], // more decimals only when needed...
    [1_000_010n, "1.00001"], // ...with trailing zeros removed
    [1n, "0.000001"],
    [0n, "0.00"], // zero is fine here: a balance can be zero
    [1_234_567_891_011n, "1234567.891011"],
    [9_007_199_254_740_993_000_000n, "9007199254740993.00"], // beyond Number.MAX_SAFE_INTEGER
  ])("converts %s base units to %s dollars", (units, expected) => {
    expect(fromBaseUnits(units)).toBe(expected);
  });

  it("rejects negative amounts", () => {
    expect(() => fromBaseUnits(-1n)).toThrow(OUR_ERROR);
    expect(() => fromBaseUnits(-1n)).toThrow(/must not be negative/);
  });
});

describe("round trip", () => {
  it.each(["0.01", "2.50", "5.00", "1.2345", "0.000001", "1234567.891011"])(
    "fromBaseUnits(toBaseUnits(%s)) gives the same string back",
    (dollars) => {
      expect(fromBaseUnits(toBaseUnits(dollars))).toBe(dollars);
    },
  );
});
