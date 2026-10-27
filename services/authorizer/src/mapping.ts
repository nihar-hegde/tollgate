// Converts database rows into the gate's types and into the API's JSON (Saifuro's field names, dollar strings).

import type { agents, decisions, mandates, reviews } from "@tollgate/db";
import {
  fromBaseUnits,
  MandateCurrency,
  type AuthorizationRequest,
  type Mandate,
} from "@tollgate/shared";

export type AgentRow = typeof agents.$inferSelect;
export type MandateRow = typeof mandates.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;

export type DecisionRecord = {
  decision: DecisionRow;
  review: ReviewRow | null;
  supersededBy: string | null;
};

export function toMandate(row: MandateRow): Mandate {
  return {
    mandate: row.id,
    agent: row.agentId,
    principal: row.principal,
    limits: {
      per_transaction: row.perTransaction,
      per_month: row.perMonth,
      currency: MandateCurrency.parse(row.currency),
    },
    categories: row.categories,
    expires: row.expires,
    status: row.status,
    created_at: row.createdAt,
    ...(row.reviewAbove !== null && { review_above: row.reviewAbove }),
    ...(row.replacesId !== null && { replaces: row.replacesId }),
  };
}

export function requestOf(row: DecisionRow): AuthorizationRequest {
  return {
    agent: row.agentId,
    amount: row.amount,
    currency: row.currency,
    recipient: row.recipient,
    category: row.category,
    ...(row.protocol !== null && { protocol: row.protocol }),
  };
}

export function agentView(row: AgentRow) {
  return {
    agent: row.id,
    name: row.name,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export function mandateView(row: MandateRow) {
  return {
    mandate: row.id,
    principal: row.principal,
    agent: row.agentId,
    limits: {
      per_transaction: fromBaseUnits(row.perTransaction),
      per_month: fromBaseUnits(row.perMonth),
      currency: row.currency,
    },
    categories: row.categories,
    review_above: row.reviewAbove === null ? null : fromBaseUnits(row.reviewAbove),
    expires: row.expires,
    status: row.status,
    replaces: row.replacesId,
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

export function decisionView({ decision, review, supersededBy }: DecisionRecord, now: Date) {
  return {
    decision: decision.id,
    request: {
      agent: decision.agentId,
      amount: fromBaseUnits(decision.amount),
      currency: decision.currency,
      recipient: decision.recipient,
      category: decision.category,
      protocol: decision.protocol,
    },
    verdict: decision.verdict,
    reason: decision.reason,
    mandate: decision.mandateId,
    policy_version: decision.policyVersion,
    nonce: decision.nonce,
    mode: decision.mode,
    issued_at: decision.issuedAt.toISOString(),
    verdict_token: decision.verdictToken,
    supersedes: decision.supersedesId,
    superseded_by: supersededBy,
    review: review === null ? null : reviewView(review, now),
  };
}
export type DecisionView = ReturnType<typeof decisionView>;

// "expired" is computed, never stored (ADR 0003).
function reviewView(row: ReviewRow, now: Date) {
  const expired = row.status === "pending" && now >= row.expiresAt;
  return {
    review: row.id,
    status: expired ? "expired" : row.status,
    expires_at: row.expiresAt.toISOString(),
    resolved_at: row.resolvedAt?.toISOString() ?? null,
  };
}
