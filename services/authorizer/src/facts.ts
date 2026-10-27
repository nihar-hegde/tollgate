import { agents, decisions, deliveries, mandates, type Transaction } from "@tollgate/db";
import { VERDICT_TTL_SECONDS, type AuthorizationRequest } from "@tollgate/shared";
import { and, count, eq, exists, gt, ne, or, sql } from "drizzle-orm";
import type { GateInput } from "./gates";
import { toMandate } from "./mapping";

const SPEND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const VELOCITY_WINDOW_MS = 60 * 1000;
// How long an allow can still be spent: its token's lifetime plus a minute of clock skew.
const USABLE_MS = (VERDICT_TTL_SECONDS + 60) * 1000;

// Advisory lock namespaces, so an agent id and an idempotency key never share a lock.
const AGENT_LOCKS = 1;
const IDEMPOTENCY_LOCKS = 2;

// Serialises everything touching one agent's spend, so two concurrent requests can't both fit under a limit.
export async function lockAgent(tx: Transaction, agentId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AGENT_LOCKS}, hashtext(${agentId}))`);
}

// Serialises requests sharing a key even across agents, so the second always sees the first's decision.
export async function lockIdempotencyKey(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${IDEMPOTENCY_LOCKS}, hashtext(${key}))`);
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
    spentLast30Days: await spentLast30Days(tx, request.agent, now),
    decisionsLast60s: await decisionsSince(tx, request.agent, ago(now, VELOCITY_WINDOW_MS)),
    now,
  };
}

// ADR 0002 rule 3: settled plus still usable. An allow counts while its token can
// be spent, and for the whole 30 days once a seller accepted it, unless that payment failed.
async function spentLast30Days(tx: Transaction, agentId: string, now: Date): Promise<bigint> {
  const acceptedBySeller = tx
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.decisionId, decisions.id), ne(deliveries.status, "failed")));

  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${decisions.amount}), 0)`.mapWith(BigInt) })
    .from(decisions)
    .where(
      and(
        eq(decisions.agentId, agentId),
        eq(decisions.verdict, "allow"),
        gt(decisions.issuedAt, ago(now, SPEND_WINDOW_MS)),
        or(gt(decisions.issuedAt, ago(now, USABLE_MS)), exists(acceptedBySeller)),
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
