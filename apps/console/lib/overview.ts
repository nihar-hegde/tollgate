// The numbers on the overview: what was decided, what was actually paid, and what the chain disagrees with.

import { agents, decisions, deliveries, mandates, reviews, type Db } from "@tollgate/db";
import { reconcile } from "@tollgate/indexer/reconcile";
import { and, count, eq, gte, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function verdictCounts(db: Db, since: Date) {
  return db
    .select({ verdict: decisions.verdict, count: count() })
    .from(decisions)
    .where(gte(decisions.issuedAt, since))
    .groupBy(decisions.verdict)
    .orderBy(decisions.verdict);
}

// Settled spend per agent, today (UTC) and over 30 days, next to its active mandate's 30-day limit.
export async function spendByAgent(db: Db, now: Date) {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const settledSince = (since: Date) =>
    sql<string>`coalesce(sum(${deliveries.amount}) filter (where ${deliveries.createdAt} >= ${since}), 0)`.mapWith(
      BigInt,
    );

  const spent = await db
    .select({
      agent: deliveries.agentId,
      today: settledSince(startOfDay),
      last30Days: settledSince(thirtyDaysAgo),
    })
    .from(deliveries)
    .where(eq(deliveries.status, "settled"))
    .groupBy(deliveries.agentId);
  const limits = await db
    .select({ agent: mandates.agentId, perMonth: mandates.perMonth })
    .from(mandates)
    .where(eq(mandates.status, "active"));
  const waiting = await db
    .select({ agent: decisions.agentId, count: count() })
    .from(reviews)
    .innerJoin(decisions, eq(reviews.decisionId, decisions.id))
    .where(and(eq(reviews.status, "pending"), gte(reviews.expiresAt, now)))
    .groupBy(decisions.agentId);
  const allAgents = await db
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .orderBy(agents.id);

  return allAgents.map(({ id, status }) => {
    const row = spent.find((s) => s.agent === id);
    return {
      agent: id,
      status,
      today: row?.today ?? 0n,
      last30Days: row?.last30Days ?? 0n,
      perMonth: limits.find((l) => l.agent === id)?.perMonth ?? null,
      waitingReviews: waiting.find((w) => w.agent === id)?.count ?? 0,
    };
  });
}

// The indexer's lists for this seller, or null when the console isn't told which seller it is.
export async function reconciliation(db: Db, now: Date) {
  const seller = process.env.SELLER_ADDRESS;
  return seller ? reconcile(db, seller, now) : null;
}
