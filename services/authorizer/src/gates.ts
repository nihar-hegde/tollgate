// The decision logic. A pure function: everything it needs is passed in, and
// it never reads the database, the clock or the network. The service gathers
// the facts; this file decides. Rule interpretations are in ADR 0002.
//
// Gates run in Saifuro's documented order and the first failure decides:
//   1 mandate → 2 revoked → 3 expired → 4 category →
//   5 per-transaction, then rolling 30 days → 6 velocity → 7 review → allow

import {
  fromBaseUnits,
  type AgentStatus,
  type AuthorizationRequest,
  type Mandate,
  type Verdict,
} from "@tollgate/shared";

// Saifuro's fixed rule: more than 10 decisions per agent per 60 seconds.
export const VELOCITY_LIMIT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GateInput = {
  request: AuthorizationRequest;
  // null when the request names an agent that doesn't exist.
  agent: { id: string; status: AgentStatus } | null;
  // Every mandate this agent has held, active and revoked, in any currency.
  mandates: readonly Mandate[];
  // Base units: settled payments plus live, unsettled allows (ADR 0002 rule 3).
  spentLast30Days: bigint;
  // Decisions for this agent in the last 60 seconds, denials included.
  decisionsLast60s: number;
  now: Date;
};

export type GateResult = {
  verdict: Verdict;
  reason: string;
  // The mandate the decision was made under; null only for deny_no_mandate.
  mandate: string | null;
};

export type GateOptions = {
  // Set when an operator approves a review: the review gate is passed, every other gate still runs.
  reviewApproved?: boolean;
};

export function evaluate(input: GateInput, options: GateOptions = {}): GateResult {
  const { request, agent, now } = input;

  // Gate 1: is there a mandate to judge this request by?
  if (agent === null) {
    return noMandate(`unknown agent ${request.agent}`);
  }
  if (agent.status === "disabled") {
    return noMandate(`agent ${agent.id} is disabled`);
  }
  const mandate = applicableMandate(input.mandates, request.currency);
  if (mandate === undefined) {
    return noMandate(`no mandate for ${agent.id} in ${request.currency}`);
  }

  const decide = (verdict: Verdict, reason: string): GateResult => ({
    verdict,
    reason,
    mandate: mandate.mandate,
  });

  // Gate 2: revoked mandates authorize nothing.
  if (mandate.status === "revoked") {
    return decide("deny_revoked", `mandate ${mandate.mandate} is revoked`);
  }

  // Gate 3: valid through the end of its expiry date, UTC.
  if (now.getTime() >= expiryCutoff(mandate.expires).getTime()) {
    return decide(
      "deny_expired",
      `mandate ${mandate.mandate} expired at end of ${mandate.expires} UTC`,
    );
  }

  // Gate 4: the category must be one the mandate allows, exactly.
  if (!mandate.categories.includes(request.category)) {
    const allowed = mandate.categories.join(", ");
    return decide("deny_category", `category ${request.category} not in mandate (${allowed})`);
  }

  // Gate 5: amount limits. Landing exactly on a limit is allowed.
  const { per_transaction, per_month } = mandate.limits;
  const amount = fromBaseUnits(request.amount);
  if (request.amount > per_transaction) {
    const limit = fromBaseUnits(per_transaction);
    return decide("deny_limit", `amount ${amount} exceeds per_transaction limit ${limit}`);
  }
  if (input.spentLast30Days + request.amount > per_month) {
    const spent = fromBaseUnits(input.spentLast30Days);
    const limit = fromBaseUnits(per_month);
    return decide(
      "deny_limit",
      `30-day spend ${spent} + ${amount} exceeds per_month limit ${limit}`,
    );
  }

  // Gate 6: runaway-loop protection. This request would be one too many.
  if (input.decisionsLast60s >= VELOCITY_LIMIT) {
    return decide(
      "deny_velocity",
      `${input.decisionsLast60s} decisions in the last 60s already (limit ${VELOCITY_LIMIT})`,
    );
  }

  // Gate 7: large amounts wait for a human. No review_above means no reviews.
  if (
    !options.reviewApproved &&
    mandate.review_above !== undefined &&
    request.amount > mandate.review_above
  ) {
    const threshold = fromBaseUnits(mandate.review_above);
    return decide("review", `amount ${amount} exceeds review_above ${threshold}`);
  }

  return decide("allow", "passed all checks");
}

/**
 * The first moment a mandate is no longer valid: midnight UTC after its
 * expiry date. "2026-12-31" → 2027-01-01T00:00:00.000Z.
 */
export function expiryCutoff(expires: string): Date {
  const startOfExpiryDay = new Date(`${expires}T00:00:00.000Z`);
  return new Date(startOfExpiryDay.getTime() + DAY_MS);
}

/**
 * The mandate to judge by (ADR 0002 rule 1): the agent's active mandate in
 * this currency, or if there is none, the newest one (which is revoked, so
 * gate 2 names it). The database allows only one active mandate per agent and
 * currency, so `find` never has to choose between two.
 */
function applicableMandate(mandates: readonly Mandate[], currency: string): Mandate | undefined {
  const inCurrency = mandates.filter((m) => m.limits.currency === currency);
  return inCurrency.find((m) => m.status === "active") ?? newest(inCurrency);
}

function newest(mandates: readonly Mandate[]): Mandate | undefined {
  return mandates.reduce<Mandate | undefined>(
    (latest, m) => (latest === undefined || m.created_at > latest.created_at ? m : latest),
    undefined,
  );
}

function noMandate(reason: string): GateResult {
  return { verdict: "deny_no_mandate", reason, mandate: null };
}
