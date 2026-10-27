import { describe, expect, it } from "vitest";
import { traceOf, type TraceInput } from "./trace";

const ISSUED = new Date("2026-10-27T12:00:00Z");
const later = (seconds: number) => new Date(ISSUED.getTime() + seconds * 1000);

const allow = { verdict: "allow", reason: "passed all checks", issuedAt: ISSUED };
const review = {
  verdict: "review",
  reason: "amount 3.00 exceeds review_above 2.00",
  issuedAt: ISSUED,
};
const delivery = (overrides: Partial<NonNullable<TraceInput["delivery"]>> = {}) => ({
  status: "settled" as const,
  createdAt: later(2),
  completedAt: later(4),
  txHash: "0xabc",
  failure: null,
  ...overrides,
});

function trace(input: Partial<TraceInput>) {
  const { steps, stage } = traceOf({
    decision: allow,
    review: null,
    delivery: null,
    settlement: null,
    now: later(10),
    ...input,
  });
  return { states: steps.map((s) => s.state), stage, steps };
}

describe("an allowed payment", () => {
  it("is confirmed once the indexer has seen the transfer", () => {
    const { states, stage, steps } = trace({
      delivery: delivery(),
      settlement: { blockNumber: 50980908n },
    });
    expect(states).toEqual(["done", "done", "done", "done"]);
    expect(stage).toBe("confirmed");
    expect(steps[3]?.detail).toBe("on-chain in block 50980908");
  });

  it("waits for confirmations after the facilitator settled", () => {
    expect(trace({ delivery: delivery() })).toMatchObject({
      states: ["done", "done", "done", "pending"],
      stage: "settled",
    });
  });

  it("waits for the facilitator while the delivery is pending", () => {
    expect(
      trace({ delivery: delivery({ status: "pending", completedAt: null, txHash: null }) }),
    ).toMatchObject({
      states: ["done", "done", "pending", "skipped"],
      stage: "verified",
    });
  });

  it("shows a failed payment and why", () => {
    const { states, stage, steps } = trace({
      delivery: delivery({ status: "failed", txHash: null, failure: "insufficient_funds" }),
    });
    expect(states).toEqual(["done", "done", "failed", "skipped"]);
    expect(stage).toBe("payment failed");
    expect(steps[2]?.detail).toBe("insufficient_funds");
  });

  it("waits for the agent to pay while the approval is still valid", () => {
    expect(trace({ now: later(299) })).toMatchObject({
      states: ["done", "pending", "skipped", "skipped"],
      stage: "authorized",
    });
  });

  it("is unused once the approval expired", () => {
    const { states, stage, steps } = trace({ now: later(300) });
    expect(states).toEqual(["done", "skipped", "skipped", "skipped"]);
    expect(stage).toBe("unused");
    expect(steps[1]?.detail).toBe("the approval expired unused");
  });
});

describe("a decision that pays nothing itself", () => {
  it("stops at authorized for a denial", () => {
    const decision = {
      verdict: "deny_limit",
      reason: "amount 6.00 exceeds per_transaction limit 5.00",
      issuedAt: ISSUED,
    };
    const { states, stage, steps } = trace({ decision });
    expect(states).toEqual(["failed", "skipped", "skipped", "skipped"]);
    expect(stage).toBe("denied");
    expect(steps[0]?.detail).toBe("deny_limit: amount 6.00 exceeds per_transaction limit 5.00");
  });

  it.each([
    ["pending", later(10), "awaiting review", "pending"],
    ["approved", later(10), "approved", "done"],
    ["denied", later(10), "review denied", "failed"],
    ["pending", later(24 * 60 * 60), "review expired", "failed"],
  ] as const)("is a review %s at %s → %s", (status, now, stage, first) => {
    const result = trace({
      decision: review,
      review: { status, expiresAt: later(24 * 60 * 60) },
      now,
    });
    expect(result.stage).toBe(stage);
    expect(result.states).toEqual([first, "skipped", "skipped", "skipped"]);
  });
});
