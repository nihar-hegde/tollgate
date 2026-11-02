import { createHash } from "node:crypto";
import { decisions, idempotencyKeys, one, reviews, type Transaction } from "@tollgate/db";
import {
  fromBaseUnits,
  newId,
  VERDICT_ISSUER,
  VERDICT_TTL_SECONDS,
  type AuthorizationRequest,
} from "@tollgate/shared";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "./context";
import { ApiError } from "./errors";
import { loadFacts, lockAgent, lockIdempotencyKey } from "./facts";
import { evaluate, type GateResult } from "./gates";
import type { DecisionRecord, DecisionRow } from "./mapping";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AuthorizeInput = {
  request: AuthorizationRequest;
  idempotencyKey: string;
};

// One transaction: if anything fails nothing is stored, so a 5xx is never remembered by the idempotency key.
export async function authorize(
  ctx: Context,
  { request, idempotencyKey }: AuthorizeInput,
): Promise<DecisionRecord & { replayed: boolean }> {
  const hash = requestHash(request);

  return ctx.db.transaction(async (tx) => {
    // Always key first, then agent; approvals take only the agent lock, so this order can't deadlock.
    await lockIdempotencyKey(tx, idempotencyKey);
    await lockAgent(tx, request.agent);
    // Read the clock once the locks are held, so the decision time is when it was decided.
    const now = wholeSeconds(ctx.now());

    const previous = await findIdempotencyKey(tx, idempotencyKey, now);
    if (previous) {
      if (previous.requestHash !== hash) {
        throw new ApiError(
          422,
          "idempotency_key_reused",
          "this Idempotency-Key was already used with a different request",
        );
      }
      const original = await loadDecision(tx, previous.decisionId);
      if (!original) throw new Error(`idempotency key points at missing ${previous.decisionId}`);
      return { ...original, replayed: true };
    }

    const result = evaluate(await loadFacts(tx, request, now));
    const decision = await recordDecision(tx, ctx, { request, result, now });
    const review = result.verdict === "review" ? await openReview(tx, decision, now) : null;
    await rememberIdempotencyKey(tx, { key: idempotencyKey, hash, decisionId: decision.id, now });

    return { decision, review, supersededBy: null, replayed: false };
  });
}

export async function recordDecision(
  tx: Transaction,
  ctx: Context,
  input: { request: AuthorizationRequest; result: GateResult; now: Date; supersedes?: string },
): Promise<DecisionRow> {
  const { request, result, now, supersedes } = input;
  const id = newId("decision");
  const nonce = newId("nonce");
  const iat = now.getTime() / 1000;

  const verdictToken = await ctx.signer.sign({
    iss: VERDICT_ISSUER,
    jti: id,
    iat,
    exp: iat + VERDICT_TTL_SECONDS,
    verdict: result.verdict,
    mandate: result.mandate,
    policy_version: ctx.policyVersion,
    nonce,
    request: {
      agent: request.agent,
      amount: fromBaseUnits(request.amount),
      currency: request.currency,
      recipient: request.recipient,
      category: request.category,
    },
    ...(supersedes !== undefined && { supersedes }),
  });

  const rows = await tx
    .insert(decisions)
    .values({
      id,
      agentId: request.agent,
      amount: request.amount,
      currency: request.currency,
      recipient: request.recipient,
      category: request.category,
      protocol: request.protocol ?? null,
      verdict: result.verdict,
      reason: result.reason,
      mandateId: result.mandate,
      policyVersion: ctx.policyVersion,
      nonce,
      mode: ctx.mode,
      issuedAt: now,
      verdictToken,
      supersedesId: supersedes ?? null,
    })
    .returning();
  return one(rows);
}

export async function loadDecision(
  q: Pick<Transaction, "select">,
  id: string,
): Promise<DecisionRecord | null> {
  const [decision] = await q.select().from(decisions).where(eq(decisions.id, id));
  if (!decision) return null;

  const [review] = await q.select().from(reviews).where(eq(reviews.decisionId, id));
  const [successor] = await q
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.supersedesId, id));
  return { decision, review: review ?? null, supersededBy: successor?.id ?? null };
}

// Tokens count time in whole seconds; keeping issued_at whole makes it equal to the token's iat.
export function wholeSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

// Hashes the parsed request, so formatting and field order don't matter, only the values.
function requestHash(r: AuthorizationRequest): string {
  const values = [r.agent, r.amount.toString(), r.currency, r.recipient, r.category, r.protocol];
  return createHash("sha256")
    .update(JSON.stringify(values.map((v) => v ?? null)))
    .digest("hex");
}

async function findIdempotencyKey(tx: Transaction, key: string, now: Date) {
  const since = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
  const [row] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), gt(idempotencyKeys.createdAt, since)));
  return row;
}

// Insert, or take over a key last used more than 24 hours ago.
async function rememberIdempotencyKey(
  tx: Transaction,
  { key, hash, decisionId, now }: { key: string; hash: string; decisionId: string; now: Date },
): Promise<void> {
  const row = { key, requestHash: hash, decisionId, createdAt: now };
  await tx
    .insert(idempotencyKeys)
    .values(row)
    .onConflictDoUpdate({ target: idempotencyKeys.key, set: row });
}

async function openReview(tx: Transaction, decision: DecisionRow, now: Date) {
  const rows = await tx
    .insert(reviews)
    .values({
      id: newId("review"),
      decisionId: decision.id,
      expiresAt: new Date(now.getTime() + REVIEW_WINDOW_MS),
      createdAt: now,
    })
    .returning();
  return one(rows);
}
