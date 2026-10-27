// Mandates are never edited: create, revoke, or replace (revoke + create in one transaction).

import { agents, mandates, one, type Transaction } from "@tollgate/db";
import { newId, type MandateInput } from "@tollgate/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Store } from "./context";
import { ApiError, notFound } from "./errors";
import { lockAgent } from "./facts";
import type { MandateRow } from "./mapping";

export async function createMandate(store: Store, input: MandateInput): Promise<MandateRow> {
  return store.db.transaction(async (tx) => {
    await lockAgent(tx, input.agent);
    await requireAgent(tx, input.agent);
    if (await activeMandate(tx, input.agent, input.limits.currency)) {
      throw new ApiError(
        409,
        "active_mandate_exists",
        `${input.agent} already has an active ${input.limits.currency} mandate; replace it instead`,
      );
    }
    return insertMandate(tx, input, store.now());
  });
}

export async function replaceMandate(
  store: Store,
  id: string,
  input: MandateInput,
): Promise<MandateRow> {
  return store.db.transaction(async (tx) => {
    await lockAgent(tx, input.agent);
    const old = await findMandate(tx, id);
    if (old.agentId !== input.agent || old.currency !== input.limits.currency) {
      throw new ApiError(
        422,
        "replacement_mismatch",
        "a replacement must be for the same agent and currency",
      );
    }
    if (old.status !== "active") {
      throw new ApiError(409, "mandate_revoked", `mandate ${id} is revoked; create a new one`);
    }

    const now = store.now();
    await revoke(tx, id, now);
    return insertMandate(tx, input, now, id);
  });
}

export async function revokeMandate(store: Store, id: string): Promise<MandateRow> {
  return store.db.transaction(async (tx) => {
    const { agentId } = await findMandate(tx, id);
    await lockAgent(tx, agentId);
    // Re-read under the lock: a concurrent revoke or replace may have just landed.
    if ((await findMandate(tx, id)).status !== "active") {
      throw new ApiError(409, "mandate_revoked", `mandate ${id} is already revoked`);
    }
    return revoke(tx, id, store.now());
  });
}

export async function listMandates({ db }: Store, agentId: string): Promise<MandateRow[]> {
  return db
    .select()
    .from(mandates)
    .where(eq(mandates.agentId, agentId))
    .orderBy(asc(mandates.createdAt));
}

async function insertMandate(
  tx: Transaction,
  input: MandateInput,
  now: Date,
  replacesId?: string,
): Promise<MandateRow> {
  const rows = await tx
    .insert(mandates)
    .values({
      id: newId("mandate"),
      agentId: input.agent,
      principal: input.principal,
      perTransaction: input.limits.per_transaction,
      perMonth: input.limits.per_month,
      currency: input.limits.currency,
      categories: input.categories,
      reviewAbove: input.review_above ?? null,
      expires: input.expires,
      replacesId: replacesId ?? null,
      createdAt: now,
    })
    .returning();
  return one(rows);
}

async function revoke(tx: Transaction, id: string, now: Date): Promise<MandateRow> {
  const rows = await tx
    .update(mandates)
    .set({ status: "revoked", revokedAt: now })
    .where(eq(mandates.id, id))
    .returning();
  return one(rows);
}

async function findMandate(tx: Transaction, id: string): Promise<MandateRow> {
  const [row] = await tx.select().from(mandates).where(eq(mandates.id, id));
  if (!row) throw notFound(`mandate ${id}`);
  return row;
}

async function activeMandate(tx: Transaction, agentId: string, currency: string) {
  const [row] = await tx
    .select({ id: mandates.id })
    .from(mandates)
    .where(
      and(
        eq(mandates.agentId, agentId),
        eq(mandates.currency, currency),
        eq(mandates.status, "active"),
      ),
    );
  return row;
}

async function requireAgent(tx: Transaction, agentId: string): Promise<void> {
  const [row] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
  if (!row) throw notFound(`agent ${agentId}`);
}
