// A payment's path: authorized → verified → settled → confirmed. Pure, so every branch is testable.

import { VERDICT_TTL_SECONDS } from "@tollgate/shared";
import { shortHex } from "./format";

export type StepName = "authorized" | "verified" | "settled" | "confirmed";
export type StepState = "done" | "pending" | "failed" | "skipped";
export type Step = { name: StepName; state: StepState; detail: string; at: Date | null };

// How far a payment got, in a word or two, for the decisions table.
export type Stage =
  | "denied"
  | "awaiting review"
  | "approved"
  | "review denied"
  | "review expired"
  | "authorized"
  | "unused"
  | "verified"
  | "payment failed"
  | "settled"
  | "confirmed";

export type Trace = { steps: Step[]; stage: Stage };

export type TraceInput = {
  decision: { verdict: string; reason: string; issuedAt: Date };
  review: { status: "pending" | "approved" | "denied"; expiresAt: Date } | null;
  delivery: {
    status: "pending" | "settled" | "failed";
    createdAt: Date;
    completedAt: Date | null;
    txHash: string | null;
    failure: string | null;
  } | null;
  settlement: { blockNumber: bigint } | null;
  now: Date;
};

export function traceOf({ decision, review, delivery, settlement, now }: TraceInput): Trace {
  if (decision.verdict === "review") return reviewTrace(decision, review, now);
  if (decision.verdict !== "allow") {
    const detail = `${decision.verdict}: ${decision.reason}`;
    return notPaid(step("authorized", "failed", detail, decision.issuedAt), "denied");
  }

  const authorized = step("authorized", "done", decision.reason, decision.issuedAt);
  if (!delivery) {
    const expiresAt = decision.issuedAt.getTime() + VERDICT_TTL_SECONDS * 1000;
    return now.getTime() < expiresAt
      ? withRest(
          [authorized, step("verified", "pending", "waiting for the agent to pay")],
          "authorized",
        )
      : withRest(
          [authorized, step("verified", "skipped", "the approval expired unused")],
          "unused",
        );
  }

  const verified = step("verified", "done", "the seller accepted the verdict", delivery.createdAt);
  if (delivery.status === "pending") {
    return withRest(
      [authorized, verified, step("settled", "pending", "waiting for the facilitator")],
      "verified",
    );
  }
  if (delivery.status === "failed") {
    const failed = step(
      "settled",
      "failed",
      delivery.failure ?? "payment failed",
      delivery.completedAt,
    );
    return withRest([authorized, verified, failed], "payment failed");
  }

  const settled = step(
    "settled",
    "done",
    `tx ${delivery.txHash ? shortHex(delivery.txHash) : "?"}`,
    delivery.completedAt,
  );
  return settlement
    ? {
        steps: [
          authorized,
          verified,
          settled,
          step("confirmed", "done", `on-chain in block ${settlement.blockNumber}`),
        ],
        stage: "confirmed",
      }
    : {
        steps: [
          authorized,
          verified,
          settled,
          step("confirmed", "pending", "waiting for confirmations"),
        ],
        stage: "settled",
      };
}

// A review decision is never paid itself; an approval pays under the new allow it issues.
function reviewTrace(
  decision: TraceInput["decision"],
  review: TraceInput["review"],
  now: Date,
): Trace {
  const at = decision.issuedAt;
  if (review?.status === "approved") {
    return notPaid(
      step("authorized", "done", "review approved: the payment uses the approving allow", at),
      "approved",
    );
  }
  if (review?.status === "denied") {
    return notPaid(step("authorized", "failed", "review denied", at), "review denied");
  }
  if (review && now >= review.expiresAt) {
    return notPaid(
      step("authorized", "failed", "review expired after 24 hours", at),
      "review expired",
    );
  }
  return notPaid(
    step("authorized", "pending", `waiting for review: ${decision.reason}`, at),
    "awaiting review",
  );
}

function notPaid(authorized: Step, stage: Stage): Trace {
  return withRest([authorized], stage);
}

// Fills in the steps never reached.
function withRest(reached: Step[], stage: Stage): Trace {
  const names: StepName[] = ["authorized", "verified", "settled", "confirmed"];
  return {
    steps: names.map((name) => reached.find((s) => s.name === name) ?? step(name, "skipped", "")),
    stage,
  };
}

function step(name: StepName, state: StepState, detail: string, at: Date | null = null): Step {
  return { name, state, detail, at };
}
