import { agents, decisions, mandates, type Transaction } from "@tollgate/db";
import type { AuthorizationRequest } from "@tollgate/shared";
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { GateInput } from "./gates";
import { toMandate } from "./mapping";

const SPEND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const VELOCITY_WINDOW_MS = 60 * 1000;

// Serialises everything touching one agent's spend, so two concurrent requests can't both fit under a limit.
export async function lockAgent(tx: Transaction, agentId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agentId}))`);
}

export async function loadFacts(
  tx: Transaction,
  request: AuthorizationRequest,
  now: Date,
): Promise<GateInput> {
  const [agent] = await tx
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .where(eq(agents.id, request.agent));
  const history = await tx.select().from(mandates).where(eq(mandates.agentId, request.agent));

  return {
    request,
    agent: agent ?? null,
    mandates: history.map(toMandate),
    spentLast30Days: await allowedSince(tx, request.agent, ago(now, SPEND_WINDOW_MS)),
    decisionsLast60s: await decisionsSince(tx, request.agent, ago(now, VELOCITY_WINDOW_MS)),
    now,
  };
}

// Interim spend rule until settlements are recorded: every allow counts, used or not (ADR 0004).
async function allowedSince(tx: Transaction, agentId: string, since: Date): Promise<bigint> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${decisions.amount}), 0)`.mapWith(BigInt) })
    .from(decisions)
    .where(
      and(
        eq(decisions.agentId, agentId),
        eq(decisions.verdict, "allow"),
        gt(decisions.issuedAt, since),
      ),
    );
  return row?.total ?? 0n;
}

async function decisionsSince(tx: Transaction, agentId: string, since: Date): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(decisions)
    .where(and(eq(decisions.agentId, agentId), gt(decisions.issuedAt, since)));
  return row?.total ?? 0;
}

function ago(now: Date, ms: number): Date {
  return new Date(now.getTime() - ms);
}
