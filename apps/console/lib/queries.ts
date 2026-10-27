// Reads for the console, straight from Postgres. Writes go through the authorizer's API instead.

import {
  agents,
  decisions,
  deliveries,
  mandates,
  reviews,
  settlements,
  type Db,
} from "@tollgate/db";
import type { Verdict } from "@tollgate/shared";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { traceOf } from "./trace";

export type DecisionFilters = { verdict?: Verdict | undefined; agent?: string | undefined };

const LOG_LIMIT = 200;

// A decision with its review (if any), its delivery (if a seller accepted it) and its on-chain settlement.
function withPayment(db: Db) {
  return db
    .select({ decision: decisions, review: reviews, delivery: deliveries, settlement: settlements })
    .from(decisions)
    .leftJoin(reviews, eq(reviews.decisionId, decisions.id))
    .leftJoin(deliveries, eq(deliveries.decisionId, decisions.id))
    .leftJoin(settlements, eq(settlements.txHash, deliveries.txHash));
}

export async function listDecisions(db: Db, filters: DecisionFilters, now: Date) {
  const where: SQL[] = [];
  if (filters.verdict) where.push(eq(decisions.verdict, filters.verdict));
  if (filters.agent) where.push(eq(decisions.agentId, filters.agent));

  const rows = await withPayment(db)
    .where(and(...where))
    .orderBy(desc(decisions.issuedAt), desc(decisions.id))
    .limit(LOG_LIMIT);

  return rows.map((row) => ({ ...row, trace: traceOf({ ...row, now }) }));
}

export type DecisionDetail = NonNullable<Awaited<ReturnType<typeof getDecision>>>;

export async function getDecision(db: Db, id: string, now: Date) {
  const [row] = await withPayment(db).where(eq(decisions.id, id));
  if (!row) return null;

  const { decision } = row;
  const [mandate] = decision.mandateId
    ? await db.select().from(mandates).where(eq(mandates.id, decision.mandateId))
    : [];
  const [successor] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.supersedesId, id));

  return {
    ...row,
    mandate: mandate ?? null,
    supersededBy: successor?.id ?? null,
    trace: traceOf({ ...row, now }),
  };
}

// Every agent with its full mandate history, oldest mandate first.
export async function listAgentsWithMandates(db: Db) {
  const allAgents = await db.select().from(agents).orderBy(asc(agents.createdAt));
  const allMandates = await db.select().from(mandates).orderBy(asc(mandates.createdAt));
  return allAgents.map((agent) => ({
    agent,
    mandates: allMandates.filter((m) => m.agentId === agent.id),
  }));
}

export async function getMandate(db: Db, id: string) {
  const [mandate] = await db.select().from(mandates).where(eq(mandates.id, id));
  return mandate ?? null;
}
