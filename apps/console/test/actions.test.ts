import { mandates } from "@tollgate/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createAgent, createMandate, replaceMandate, revokeMandate } from "@/app/mandates/actions";
import { startAuthorizer } from "./harness";

// Server actions call into Next's cache and router; outside Next they only need to be observed.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));

const api = startAuthorizer();
const EMPTY = { error: null, message: null };

function mandateForm(agent: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields = {
    agent,
    principal: "role:research_lead",
    per_transaction: "5",
    per_month: "50",
    categories: "data",
    review_above: "2",
    expires: "2026-12-31",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

async function mandatesOf(agent: string) {
  return api.world.db
    .select()
    .from(mandates)
    .where(eq(mandates.agentId, agent))
    .orderBy(mandates.createdAt);
}

describe("mandate actions, through the authorizer", () => {
  it("creates an agent, then gives it a mandate", async () => {
    const agent = `agt_console_${Date.now()}`;
    const form = new FormData();
    form.set("id", agent);
    form.set("name", "Console agent");

    expect(await createAgent(EMPTY, form)).toEqual({
      error: null,
      message: `Agent ${agent} created.`,
    });
    const created = await createMandate(EMPTY, mandateForm(agent));
    expect(created.message).toMatch(/^Mandate mnd_[0-9a-f]{32} created\.$/);
    expect((await mandatesOf(agent)).map((m) => m.perTransaction)).toEqual([5_000_000n]);
  });

  it("shows the authorizer's refusal, e.g. a second active mandate", async () => {
    const { agent } = await api.newAgent();
    expect((await createMandate(EMPTY, mandateForm(agent))).error).toContain(
      "already has an active USD mandate",
    );
  });

  it("stops a bad form before calling the authorizer", async () => {
    const { agent } = await api.newAgent();
    const result = await createMandate(EMPTY, mandateForm(agent, { per_transaction: "60" }));
    expect(result.error).toContain("per_transaction cannot exceed per_month");
  });

  it("replaces a mandate: the old one revoked, the new one pointing back", async () => {
    const { agent, mandate } = await api.newAgent();
    await expect(
      replaceMandate(mandate, EMPTY, mandateForm(agent, { per_month: "100" })),
    ).rejects.toThrow("redirect /mandates");

    const [old, successor] = await mandatesOf(agent);
    expect(old).toMatchObject({ id: mandate, status: "revoked" });
    expect(successor).toMatchObject({
      status: "active",
      replacesId: mandate,
      perMonth: 100_000_000n,
    });
  });

  it("revokes a mandate once, and says so the second time", async () => {
    const { mandate } = await api.newAgent();
    expect(await revokeMandate(mandate, EMPTY)).toEqual({
      error: null,
      message: `Mandate ${mandate} revoked.`,
    });
    expect((await revokeMandate(mandate, EMPTY)).error).toBe(
      `mandate ${mandate} is already revoked`,
    );
  });

  it("reports an unreachable authorizer instead of failing silently", async () => {
    const real = process.env.AUTHORIZER_URL;
    process.env.AUTHORIZER_URL = "http://localhost:1";
    try {
      expect((await revokeMandate("mnd_any", EMPTY)).error).toBe(
        "the authorizer at http://localhost:1 is unreachable",
      );
    } finally {
      process.env.AUTHORIZER_URL = real;
    }
  });
});
