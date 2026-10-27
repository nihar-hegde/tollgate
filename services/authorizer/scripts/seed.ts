// Creates the user-story agent and mandate if they don't exist yet. Safe to run repeatedly.

import { agents, createDb, mandates } from "@tollgate/db";
import { MandateInput } from "@tollgate/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createAgent } from "../src/agents";
import { createMandate } from "../src/mandates";

const AGENT = "agt_research_01";

const { DATABASE_URL } = z.object({ DATABASE_URL: z.url() }).parse(process.env);
const db = createDb(DATABASE_URL);
const store = { db, now: () => new Date() };

const [agent] = await db.select().from(agents).where(eq(agents.id, AGENT));
if (!agent) {
  await createAgent(store, { id: AGENT, name: "Research agent" });
  console.log(`created agent ${AGENT}`);
}

const [active] = await db
  .select()
  .from(mandates)
  .where(and(eq(mandates.agentId, AGENT), eq(mandates.status, "active")));
if (active) {
  console.log(`${AGENT} already has active mandate ${active.id}`);
} else {
  const mandate = await createMandate(
    store,
    MandateInput.parse({
      agent: AGENT,
      principal: "role:research_lead",
      limits: { per_transaction: "5", per_month: "50", currency: "USD" },
      categories: ["data"],
      review_above: "2",
      expires: "2026-12-31",
    }),
  );
  console.log(`created mandate ${mandate.id}: $5 per call, $50 per 30 days, data, review above $2`);
}

await db.$client.end();
