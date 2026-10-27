// Tests for the gate function. Every test starts from a request that passes
// all gates (`passing`) and changes one thing, so each failure points at
// exactly one rule. Amounts are written in dollars and converted with
// toBaseUnits, so "5" here means $5.00 = 5_000_000n base units.

import { toBaseUnits as dollars, type Mandate } from "@tollgate/shared";
import { describe, expect, it } from "vitest";
import { evaluate, expiryCutoff, VELOCITY_LIMIT, type GateInput } from "./gates";

const NOW = new Date("2026-10-27T12:00:00.000Z");

// The mandate from the user stories: $5 per call, $50 per 30 days,
// category data, review above $2, valid through the end of 2026.
function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandate: "mnd_00000000000000000000000000000001",
    agent: "agt_research_01",
    principal: "role:research_lead",
    limits: { per_transaction: dollars("5"), per_month: dollars("50"), currency: "USD" },
    categories: ["data"],
    review_above: dollars("2"),
    expires: "2026-12-31",
    status: "active",
    created_at: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

// A $0.01 data purchase by an enabled agent with nothing spent yet: allowed.
function passing(overrides: Partial<GateInput> = {}): GateInput {
  return {
    request: {
      agent: "agt_research_01",
      amount: dollars("0.01"),
      currency: "USD",
      recipient: "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0",
      category: "data",
      protocol: "x402",
    },
    agent: { id: "agt_research_01", status: "enabled" },
    mandates: [mandate()],
    spentLast30Days: 0n,
    decisionsLast60s: 0,
    now: NOW,
    ...overrides,
  };
}

// Change only the request fields given, keep the rest of `passing`.
function withRequest(changes: Partial<GateInput["request"]>): GateInput {
  const input = passing();
  return { ...input, request: { ...input.request, ...changes } };
}

describe("one test per decision code", () => {
  it("allows a request that passes every gate", () => {
    expect(evaluate(passing())).toEqual({
      verdict: "allow",
      reason: "passed all checks",
      mandate: "mnd_00000000000000000000000000000001",
    });
  });

  it("deny_no_mandate: unknown agent", () => {
    expect(evaluate(passing({ agent: null })).verdict).toBe("deny_no_mandate");
  });

  it("deny_revoked: the mandate was revoked", () => {
    const input = passing({ mandates: [mandate({ status: "revoked" })] });
    expect(evaluate(input).verdict).toBe("deny_revoked");
  });

  it("deny_expired: the mandate's expiry date has passed", () => {
    const input = passing({ now: new Date("2027-01-15T00:00:00.000Z") });
    expect(evaluate(input).verdict).toBe("deny_expired");
  });

  it("deny_category: category not in the mandate", () => {
    expect(evaluate(withRequest({ category: "travel" })).verdict).toBe("deny_category");
  });

  it("deny_limit: amount above the per-transaction limit", () => {
    expect(evaluate(withRequest({ amount: dollars("6") })).verdict).toBe("deny_limit");
  });

  it("deny_velocity: too many decisions in the last minute", () => {
    const input = passing({ decisionsLast60s: VELOCITY_LIMIT });
    expect(evaluate(input).verdict).toBe("deny_velocity");
  });

  it("review: amount above review_above", () => {
    expect(evaluate(withRequest({ amount: dollars("3") })).verdict).toBe("review");
  });
});

describe("gate 1: is there a mandate at all", () => {
  it("denies a disabled agent even with a valid mandate", () => {
    const input = passing({ agent: { id: "agt_research_01", status: "disabled" } });
    expect(evaluate(input)).toMatchObject({ verdict: "deny_no_mandate", mandate: null });
  });

  it("denies an agent that never had a mandate", () => {
    expect(evaluate(passing({ mandates: [] })).verdict).toBe("deny_no_mandate");
  });

  it("denies a currency the agent has no mandate in", () => {
    expect(evaluate(withRequest({ currency: "EUR" })).verdict).toBe("deny_no_mandate");
  });
});

describe("choosing the mandate (ADR 0002 rule 1)", () => {
  const oldRevoked = mandate({
    mandate: "mnd_00000000000000000000000000000001",
    status: "revoked",
    created_at: new Date("2026-09-01T00:00:00.000Z"),
  });
  const currentActive = mandate({
    mandate: "mnd_00000000000000000000000000000002",
    created_at: new Date("2026-10-01T00:00:00.000Z"),
  });
  const latestRevoked = mandate({
    mandate: "mnd_00000000000000000000000000000003",
    status: "revoked",
    created_at: new Date("2026-10-20T00:00:00.000Z"),
  });

  it("judges by the active mandate when the agent also has revoked ones", () => {
    const result = evaluate(passing({ mandates: [oldRevoked, currentActive] }));
    expect(result).toMatchObject({ verdict: "allow", mandate: currentActive.mandate });
  });

  it("prefers the active mandate even over a newer revoked one", () => {
    const result = evaluate(passing({ mandates: [latestRevoked, currentActive] }));
    expect(result).toMatchObject({ verdict: "allow", mandate: currentActive.mandate });
  });

  it("names the newest mandate when all of them are revoked, whatever the list order", () => {
    const result = evaluate(passing({ mandates: [latestRevoked, oldRevoked] }));
    expect(result).toMatchObject({ verdict: "deny_revoked", mandate: latestRevoked.mandate });

    const reversed = evaluate(passing({ mandates: [oldRevoked, latestRevoked] }));
    expect(reversed.mandate).toBe(latestRevoked.mandate);
  });
});

describe("gate 3: expiry is the end of the expiry date, UTC (ADR 0002 rule 2)", () => {
  it("puts the cutoff at midnight UTC after the expiry date", () => {
    expect(expiryCutoff("2026-12-31").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is still valid in the last millisecond of the expiry date", () => {
    const input = passing({ now: new Date("2026-12-31T23:59:59.999Z") });
    expect(evaluate(input).verdict).toBe("allow");
  });

  it("is expired from the first millisecond of the next day", () => {
    const input = passing({ now: new Date("2027-01-01T00:00:00.000Z") });
    expect(evaluate(input).verdict).toBe("deny_expired");
  });
});

describe("gate 5: amount limits (landing exactly on a limit is allowed)", () => {
  it("allows an amount exactly at the per-transaction limit", () => {
    // $5.00 is above review_above, so it passes the limit and stops at review.
    expect(evaluate(withRequest({ amount: dollars("5") })).verdict).toBe("review");
  });

  it("denies one base unit over the per-transaction limit", () => {
    expect(evaluate(withRequest({ amount: dollars("5.000001") })).verdict).toBe("deny_limit");
  });

  it("allows spend that lands exactly on the monthly limit", () => {
    const input = passing({ spentLast30Days: dollars("49.99") }); // + $0.01 = $50.00
    expect(evaluate(input).verdict).toBe("allow");
  });

  it("denies spend one base unit over the monthly limit", () => {
    const input = passing({ spentLast30Days: dollars("49.990001") });
    expect(evaluate(input).verdict).toBe("deny_limit");
  });

  it("checks the per-transaction limit before the monthly one", () => {
    const input = { ...withRequest({ amount: dollars("6") }), spentLast30Days: dollars("49") };
    expect(evaluate(input).reason).toMatch(/per_transaction/);
  });
});

describe("gate 6: velocity (ADR 0002 rule 4)", () => {
  it("allows the 10th decision in a minute", () => {
    const input = passing({ decisionsLast60s: VELOCITY_LIMIT - 1 });
    expect(evaluate(input).verdict).toBe("allow");
  });

  it("denies the 11th decision in a minute", () => {
    const input = passing({ decisionsLast60s: VELOCITY_LIMIT });
    expect(evaluate(input).verdict).toBe("deny_velocity");
  });
});

describe("gate 7: review threshold", () => {
  it("allows an amount exactly at review_above", () => {
    expect(evaluate(withRequest({ amount: dollars("2") })).verdict).toBe("allow");
  });

  it("sends one base unit over review_above to review", () => {
    expect(evaluate(withRequest({ amount: dollars("2.000001") })).verdict).toBe("review");
  });

  it("never reviews when the mandate has no review_above", () => {
    const { review_above: _unused, ...noReview } = mandate();
    const input = { ...withRequest({ amount: dollars("5") }), mandates: [noReview] };
    expect(evaluate(input).verdict).toBe("allow");
  });
});

describe("gate order: the earliest failing gate decides", () => {
  it("revoked beats wrong category", () => {
    const input = {
      ...withRequest({ category: "travel" }),
      mandates: [mandate({ status: "revoked" })],
    };
    expect(evaluate(input).verdict).toBe("deny_revoked");
  });

  it("expired beats wrong category", () => {
    const input = { ...withRequest({ category: "travel" }), now: new Date("2027-02-01") };
    expect(evaluate(input).verdict).toBe("deny_expired");
  });

  it("wrong category beats over the limit", () => {
    const input = withRequest({ category: "travel", amount: dollars("6") });
    expect(evaluate(input).verdict).toBe("deny_category");
  });

  it("over the limit beats too fast", () => {
    const input = { ...withRequest({ amount: dollars("6") }), decisionsLast60s: VELOCITY_LIMIT };
    expect(evaluate(input).verdict).toBe("deny_limit");
  });

  it("too fast beats review", () => {
    const input = { ...withRequest({ amount: dollars("3") }), decisionsLast60s: VELOCITY_LIMIT };
    expect(evaluate(input).verdict).toBe("deny_velocity");
  });
});

describe("result details", () => {
  it("names no mandate on deny_no_mandate", () => {
    expect(evaluate(passing({ agent: null })).mandate).toBeNull();
  });

  it.each([
    ["deny_revoked", passing({ mandates: [mandate({ status: "revoked" })] })],
    ["deny_category", withRequest({ category: "travel" })],
    ["review", withRequest({ amount: dollars("3") })],
  ])("names the mandate on %s", (verdict, input) => {
    expect(evaluate(input)).toMatchObject({ verdict, mandate: mandate().mandate });
  });

  it.each([
    [passing({ agent: null }), "unknown agent agt_research_01"],
    [
      passing({ agent: { id: "agt_research_01", status: "disabled" } }),
      "agent agt_research_01 is disabled",
    ],
    [withRequest({ currency: "EUR" }), "no mandate for agt_research_01 in EUR"],
    [
      passing({ mandates: [mandate({ status: "revoked" })] }),
      "mandate mnd_00000000000000000000000000000001 is revoked",
    ],
    [
      passing({ now: new Date("2027-01-01") }),
      "mandate mnd_00000000000000000000000000000001 expired at end of 2026-12-31 UTC",
    ],
    [withRequest({ category: "travel" }), "category travel not in mandate (data)"],
    [withRequest({ amount: dollars("6") }), "amount 6.00 exceeds per_transaction limit 5.00"],
    [
      passing({ spentLast30Days: dollars("49.995") }),
      "30-day spend 49.995 + 0.01 exceeds per_month limit 50.00",
    ],
    [
      passing({ decisionsLast60s: VELOCITY_LIMIT }),
      "10 decisions in the last 60s already (limit 10)",
    ],
    [withRequest({ amount: dollars("3") }), "amount 3.00 exceeds review_above 2.00"],
  ])("explains the decision: %#", (input, reason) => {
    expect(evaluate(input).reason).toBe(reason);
  });
});
