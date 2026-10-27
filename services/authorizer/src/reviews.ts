// Approving issues a new `allow` that supersedes the review decision; the gates run again first,
// so a mandate revoked or a budget spent while the review waited still blocks it.

import { decisions, reviews, type Transaction } from "@tollgate/db";
import { eq } from "drizzle-orm";
import type { Context } from "./context";
import { loadDecision, recordDecision, wholeSeconds } from "./decisions";
import { ApiError, notFound } from "./errors";
import { loadFacts, lockAgent } from "./facts";
import { evaluate } from "./gates";
import { requestOf, type DecisionRecord, type DecisionRow, type ReviewRow } from "./mapping";

export async function approveReview(ctx: Context, reviewId: string): Promise<DecisionRecord> {
  const now = wholeSeconds(ctx.now());

  return ctx.db.transaction(async (tx) => {
    const { review, decision } = await pendingReview(tx, reviewId, now);
    const request = requestOf(decision);

    const result = evaluate(await loadFacts(tx, request, now), { reviewApproved: true });
    if (result.verdict !== "allow") {
      throw new ApiError(409, "approval_blocked", `cannot approve: ${result.reason}`);
    }

    const approval = await recordDecision(tx, ctx, {
      request,
      result: { ...result, reason: `review ${review.id} approved` },
      now,
      supersedes: decision.id,
    });
    await resolve(tx, review.id, "approved", now);
    return { decision: approval, review: null, supersededBy: null };
  });
}

export async function denyReview(ctx: Context, reviewId: string): Promise<DecisionRecord> {
  const now = ctx.now();

  return ctx.db.transaction(async (tx) => {
    const { review, decision } = await pendingReview(tx, reviewId, now);
    await resolve(tx, review.id, "denied", now);
    const record = await loadDecision(tx, decision.id);
    if (!record) throw new Error(`review ${review.id} points at missing ${decision.id}`);
    return record;
  });
}

async function pendingReview(
  tx: Transaction,
  reviewId: string,
  now: Date,
): Promise<{ review: ReviewRow; decision: DecisionRow }> {
  const [found] = await tx
    .select({ review: reviews, decision: decisions })
    .from(reviews)
    .innerJoin(decisions, eq(reviews.decisionId, decisions.id))
    .where(eq(reviews.id, reviewId));
  if (!found) throw notFound(`review ${reviewId}`);

  await lockAgent(tx, found.decision.agentId);
  // Re-read under the lock: a concurrent approve or deny may have just resolved it.
  const [review] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
  if (review?.status !== "pending") {
    throw new ApiError(409, "review_resolved", `review ${reviewId} is already ${review?.status}`);
  }
  if (now >= review.expiresAt) {
    throw new ApiError(409, "review_expired", `review ${reviewId} expired`);
  }
  return { review, decision: found.decision };
}

async function resolve(
  tx: Transaction,
  reviewId: string,
  status: "approved" | "denied",
  now: Date,
): Promise<void> {
  await tx.update(reviews).set({ status, resolvedAt: now }).where(eq(reviews.id, reviewId));
}
