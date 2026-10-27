import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { DecisionView } from "../src/mapping";
import { KEYS, later, START, useAuthorizer } from "./harness";

const api = useAuthorizer();

const DAY = 24 * 60 * 60 * 1000;

// A $3 request under the user-story mandate (review above $2).
async function pendingReview(mandate: Record<string, unknown> = {}) {
  const { agent, mandate: mandateId } = await api.newAgent(mandate);
  const { body } = await api.authorize(agent, { amount: "3" });
  if (!body.review) throw new Error(`expected a review, got ${body.verdict}`);
  return { agent, mandateId, decision: body, reviewId: body.review.review };
}

const approve = (reviewId: string) =>
  api.call<DecisionView>("POST", `/v1/reviews/${reviewId}/approve`);
const deny = (reviewId: string) => api.call<DecisionView>("POST", `/v1/reviews/${reviewId}/deny`);
const getDecision = (id: string) =>
  api.call<DecisionView>("GET", `/v1/decisions/${id}`, { key: KEYS.agent });

describe("a review decision", () => {
  it("opens a pending review that expires after 24 hours", async () => {
    const { decision } = await pendingReview();
    expect(decision).toMatchObject({
      verdict: "review",
      reason: "amount 3.00 exceeds review_above 2.00",
      review: {
        status: "pending",
        expires_at: later(DAY).toISOString(),
        resolved_at: null,
      },
    });
  });
});

describe("approving", () => {
  it("issues a new allow that supersedes the review decision", async () => {
    const { decision, reviewId } = await pendingReview();
    const { status, body } = await approve(reviewId);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      verdict: "allow",
      reason: `review ${reviewId} approved`,
      supersedes: decision.decision,
      request: decision.request,
    });
    expect(body.decision).not.toBe(decision.decision);
    expect(body.nonce).not.toBe(decision.nonce);
  });

  it("signs supersedes into the new token", async () => {
    const { decision, reviewId } = await pendingReview();
    const { body } = await approve(reviewId);

    const { payload } = await jwtVerify(body.verdict_token, createLocalJWKSet(api.jwks()), {
      currentDate: START,
    });
    expect(payload).toMatchObject({ verdict: "allow", supersedes: decision.decision });
  });

  it("lets the agent find the approval from its review decision", async () => {
    const { decision, reviewId } = await pendingReview();
    const approval = await approve(reviewId);

    const { body } = await getDecision(decision.decision);
    expect(body.superseded_by).toBe(approval.body.decision);
    expect(body.review).toMatchObject({ status: "approved", resolved_at: START.toISOString() });
  });

  it("counts the approved amount toward the 30-day spend", async () => {
    const { agent, reviewId } = await pendingReview({
      limits: { per_transaction: "4", per_month: "4", currency: "USD" },
    });
    await approve(reviewId);
    expect((await api.authorize(agent, { amount: "2" })).body.verdict).toBe("deny_limit");
  });

  it("can't approve twice", async () => {
    const { reviewId } = await pendingReview();
    await approve(reviewId);
    const again = await approve(reviewId);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "review_resolved" } });
  });

  it("refuses once the review has expired", async () => {
    const { decision, reviewId } = await pendingReview();
    api.clock.now = later(DAY);

    const late = await approve(reviewId);
    expect(late.body).toMatchObject({ error: { code: "review_expired" } });
    expect((await getDecision(decision.decision)).body.review?.status).toBe("expired");
  });

  it("refuses if the mandate was revoked while the review waited", async () => {
    const { mandateId, reviewId } = await pendingReview();
    await api.call("POST", `/v1/mandates/${mandateId}/revoke`);

    const blocked = await approve(reviewId);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      error: {
        code: "approval_blocked",
        message: `cannot approve: mandate ${mandateId} is revoked`,
      },
    });
  });

  it("refuses if the budget was spent while the review waited, and stays pending", async () => {
    const { agent, decision, reviewId } = await pendingReview({
      limits: { per_transaction: "4", per_month: "4", currency: "USD" },
    });
    await api.authorize(agent, { amount: "2" });

    expect((await approve(reviewId)).body).toMatchObject({ error: { code: "approval_blocked" } });
    expect((await getDecision(decision.decision)).body.review?.status).toBe("pending");
  });
});

describe("denying", () => {
  it("closes the review without issuing anything", async () => {
    const { decision, reviewId } = await pendingReview();
    const { status, body } = await deny(reviewId);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      decision: decision.decision,
      superseded_by: null,
      review: { status: "denied" },
    });
    expect((await approve(reviewId)).status).toBe(409);
  });
});

describe("access", () => {
  it("returns 404 for an unknown review", async () => {
    expect((await approve("rev_missing")).status).toBe(404);
  });

  it("is managed with the secret key only", async () => {
    const { reviewId } = await pendingReview();
    const { status } = await api.call("POST", `/v1/reviews/${reviewId}/approve`, {
      key: KEYS.agent,
    });
    expect(status).toBe(401);
  });
});
