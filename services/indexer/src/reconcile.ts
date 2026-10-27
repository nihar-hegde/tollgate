// Compares what the seller recorded with what the chain shows. Read-only; the console calls it too.

import { deliveries, settlements, type Db } from "@tollgate/db";
import { sql } from "drizzle-orm";
import { sameAddress } from "./chain";

type Delivery = typeof deliveries.$inferSelect;
type Settlement = typeof settlements.$inferSelect;
export type Match = { delivery: Delivery; settlement: Settlement };

export type Reconciliation = {
  // The seller says settled and the chain agrees.
  confirmed: Match[];
  // Allowed, not settled: the seller accepted a verdict but nothing reached the chain in time.
  unconfirmed: Delivery[];
  // Paid without a decision: USDC arrived with no accepted verdict behind it.
  unexpected: Settlement[];
  // On-chain, but disagreeing with the seller's record.
  mismatched: (Match & { problem: string })[];
};

// Long enough for settlement plus the indexer's confirmations and polling.
export const CONFIRMATION_GRACE_MS = 10 * 60 * 1000;

export async function reconcile(db: Db, seller: string, now: Date): Promise<Reconciliation> {
  const accepted = await db
    .select()
    .from(deliveries)
    .where(sql`lower(${deliveries.recipient}) = lower(${seller})`);
  const transfers = await db
    .select()
    .from(settlements)
    .where(sql`lower(${settlements.toAddress}) = lower(${seller})`);

  const result: Reconciliation = { confirmed: [], unconfirmed: [], unexpected: [], mismatched: [] };
  const matched = new Set<Delivery>();

  for (const settlement of transfers) {
    const delivery = accepted.find((d) => paidBy(d, settlement));
    if (!delivery) {
      result.unexpected.push(settlement);
      continue;
    }
    matched.add(delivery);
    const problem = disagreement(delivery, settlement);
    if (problem) result.mismatched.push({ delivery, settlement, problem });
    else result.confirmed.push({ delivery, settlement });
  }

  for (const delivery of accepted) {
    const expected = delivery.status !== "failed";
    const overdue = now.getTime() - delivery.createdAt.getTime() >= CONFIRMATION_GRACE_MS;
    if (expected && overdue && !matched.has(delivery)) result.unconfirmed.push(delivery);
  }
  return result;
}

// The seller's tx hash, or else the payer and EIP-3009 nonce, which the chain logged too.
function paidBy(delivery: Delivery, settlement: Settlement): boolean {
  if (delivery.txHash !== null && delivery.txHash === settlement.txHash) return true;
  return (
    delivery.authorizationNonce !== null &&
    delivery.authorizationNonce === settlement.authorizationNonce &&
    delivery.payer !== null &&
    sameAddress(delivery.payer, settlement.fromAddress)
  );
}

function disagreement(delivery: Delivery, settlement: Settlement): string | null {
  if (delivery.amount !== settlement.value) {
    return `seller expected ${delivery.amount} base units, chain shows ${settlement.value}`;
  }
  if (delivery.status !== "settled") return `seller recorded ${delivery.status}, but it was paid`;
  if (delivery.txHash !== settlement.txHash) return `seller recorded tx ${delivery.txHash}`;
  return null;
}
