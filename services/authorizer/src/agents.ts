import { agents } from "@tollgate/db";
import type { AgentInput } from "@tollgate/shared";
import { asc, eq } from "drizzle-orm";
import type { Store } from "./context";
import { ApiError, notFound } from "./errors";
import type { AgentRow } from "./mapping";

export async function createAgent({ db, now }: Store, input: AgentInput): Promise<AgentRow> {
  const [created] = await db
    .insert(agents)
    .values({ ...input, createdAt: now() })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ApiError(409, "agent_exists", `agent ${input.id} already exists`);
  return created;
}

export async function listAgents({ db }: Store): Promise<AgentRow[]> {
  return db.select().from(agents).orderBy(asc(agents.createdAt));
}

export async function disableAgent({ db }: Store, id: string): Promise<AgentRow> {
  const [updated] = await db
    .update(agents)
    .set({ status: "disabled" })
    .where(eq(agents.id, id))
    .returning();
  if (!updated) throw notFound(`agent ${id}`);
  return updated;
}
