import { describe, expect, it, vi } from "vitest";
import { approveReview, denyReview } from "@/app/reviews/actions";
import { EMPTY_FORM } from "@/lib/form-state";
import { listReviews } from "@/lib/queries";
import { startAuthorizer } from "./harness";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const api = startAuthorizer();
const HOUR = 60 * 60 * 1000;

// A $3 request for a fresh agent: above its $2 review threshold.
async function waitingReview() {
  const { agent, mandate } = await api.newAgent();
  const asked = await api.authorize(agent, { amount: "3" });
  const { review } = await api.call<{ review: { review: string } }>(
    "GET",
    `/v1/decisions/${asked.decision}`,
    api.keys.secret,
  );
  return { agent, mandate, decision: asked.decision, review: review.review };
}

async function statusOf(review: string, now = new Date()) {
  const row = (await listReviews(api.world.db, now)).find((r) => r.review.id === review);
  return { status: row?.status, approval: row?.approval ?? null };
}

describe("the review queue", () => {
  it("lists a review as pending, then expired after 24 hours", async () => {
    const { review } = await waitingReview();
    expect((await statusOf(review)).status).toBe("pending");
    expect((await statusOf(review, new Date(Date.now() + 25 * HOUR))).status).toBe("expired");
  });

  it("approves through the authorizer, which issues the allow the agent pays with", async () => {
    const { review } = await waitingReview();
    const result = await approveReview(review, EMPTY_FORM);

    expect(result.message).toMatch(/^Approved as dec_[0-9a-f]{32}\.$/);
    const { status, approval } = await statusOf(review);
    expect(status).toBe("approved");
    expect(result.message).toContain(approval);
  });

  it("shows why an approval is blocked, and leaves the review waiting", async () => {
    const { review, mandate } = await waitingReview();
    await api.call("POST", `/v1/mandates/${mandate}/revoke`, api.keys.secret);

    expect((await approveReview(review, EMPTY_FORM)).error).toBe(
      `cannot approve: mandate ${mandate} is revoked`,
    );
    expect((await statusOf(review)).status).toBe("pending");
  });

  it("denies, and refuses to resolve the same review twice", async () => {
    const { review } = await waitingReview();
    expect(await denyReview(review, EMPTY_FORM)).toEqual({ error: null, message: "Denied." });
    expect((await approveReview(review, EMPTY_FORM)).error).toBe(
      `review ${review} is already denied`,
    );
  });
});
