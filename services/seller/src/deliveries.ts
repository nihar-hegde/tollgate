import { deliveries, type Db } from "@tollgate/db";
import { newId } from "@tollgate/shared";
import { and, eq } from "drizzle-orm";
import type { SignedPayment } from "./payment";
import type { Approval } from "./verdict";

export type Delivery = typeof deliveries.$inferSelect;

export type Settlement =
  { settled: true; txHash: string; payer: string | null } | { settled: false; failure: string };

type Claim = {
  approval: Approval;
  token: string;
  recipient: string;
  resource: string;
  payment: SignedPayment | null;
};

// The last step of the verdict check: record the nonce, once. The insert is the
// replay check, so two seller instances can't both accept the same verdict.
export async function claimDelivery(
  db: Db,
  { approval, token, recipient, resource, payment }: Claim,
): Promise<{ ok: true; delivery: Delivery } | { ok: false; reason: string }> {
  const [delivery] = await db
    .insert(deliveries)
    .values({
      id: newId("delivery"),
      decisionId: approval.decision,
      verdictNonce: approval.nonce,
      supersedesId: approval.supersedes,
      mandateId: approval.mandate,
      agentId: approval.agent,
      amount: approval.amount,
      recipient,
      resource,
      verdictToken: token,
      payer: payment?.payer ?? null,
      authorizationNonce: payment?.authorizationNonce ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (delivery) return { ok: true, delivery };

  const [seen] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(eq(deliveries.verdictNonce, approval.nonce));
  const reason = seen
    ? `verdict nonce ${approval.nonce} was already used`
    : `review ${approval.supersedes} was already paid for with another approval`;
  return { ok: false, reason };
}

export async function completeDelivery(
  db: Db,
  id: string,
  settlement: Settlement,
  now: Date,
): Promise<void> {
  // Keep the payer read from the signed payment unless the facilitator names one.
  const outcome = settlement.settled
    ? {
        status: "settled" as const,
        txHash: settlement.txHash,
        ...(settlement.payer !== null && { payer: settlement.payer }),
      }
    : { status: "failed" as const, failure: settlement.failure };
  // Only from pending: the indexer may already have settled it from the chain.
  await db
    .update(deliveries)
    .set({ ...outcome, completedAt: now })
    .where(and(eq(deliveries.id, id), eq(deliveries.status, "pending")));
}
