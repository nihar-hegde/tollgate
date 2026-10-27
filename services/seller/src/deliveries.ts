import { deliveries, type Db } from "@tollgate/db";
import { newId } from "@tollgate/shared";
import { eq } from "drizzle-orm";
import type { Approval } from "./verdict";

export type Delivery = typeof deliveries.$inferSelect;

export type Settlement =
  { settled: true; txHash: string; payer: string | null } | { settled: false; failure: string };

type Claim = {
  approval: Approval;
  token: string;
  recipient: string;
  resource: string;
};

// The last step of the verdict check: record the nonce, once. The insert is the
// replay check, so two seller instances can't both accept the same verdict.
export async function claimDelivery(
  db: Db,
  { approval, token, recipient, resource }: Claim,
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
  const outcome = settlement.settled
    ? { status: "settled" as const, txHash: settlement.txHash, payer: settlement.payer }
    : { status: "failed" as const, failure: settlement.failure };
  await db
    .update(deliveries)
    .set({ ...outcome, completedAt: now })
    .where(eq(deliveries.id, id));
}
