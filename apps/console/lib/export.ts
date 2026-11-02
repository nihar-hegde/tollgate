// The decision log as NDJSON: one decision per line, with Saifuro's field names and the signed token.

import { decisions, deliveries, type Db, type Transaction } from "@tollgate/db";
import { fromBaseUnits } from "@tollgate/shared";
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { DecisionFilters } from "./queries";

const BATCH = 500;

type Row = {
  decision: typeof decisions.$inferSelect;
  delivery: typeof deliveries.$inferSelect | null;
};

export function exportLine({ decision, delivery }: Row): string {
  return JSON.stringify({
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
    payment: delivery && {
      delivery: delivery.id,
      status: delivery.status,
      tx_hash: delivery.txHash,
    },
  });
}

// Oldest first, in batches. Run it inside one snapshot (see the export route): a decision can commit
// after later-stamped ones, and would otherwise shift the offsets mid-export.
export async function* exportLines(
  db: Db | Transaction,
  filters: DecisionFilters,
): AsyncGenerator<string, void> {
  const where: SQL[] = [];
  if (filters.verdict) where.push(eq(decisions.verdict, filters.verdict));
  if (filters.agent) where.push(eq(decisions.agentId, filters.agent));

  for (let offset = 0; ; offset += BATCH) {
    const rows = await db
      .select({ decision: decisions, delivery: deliveries })
      .from(decisions)
      .leftJoin(deliveries, eq(deliveries.decisionId, decisions.id))
      .where(and(...where))
      .orderBy(asc(decisions.issuedAt), asc(decisions.id))
      .limit(BATCH)
      .offset(offset);
    for (const row of rows) yield `${exportLine(row)}\n`;
    if (rows.length < BATCH) return;
  }
}
