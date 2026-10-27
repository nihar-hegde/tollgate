import { describe, expect, it } from "vitest";
import { KEYS, START, useAuthorizer } from "./harness";

const api = useAuthorizer();

type Mandate = { mandate: string; status: string; replaces: string | null };

const USER_STORY = {
  principal: "role:research_lead",
  limits: { per_transaction: "5", per_month: "50", currency: "USD" },
  categories: ["data"],
  review_above: "2",
  expires: "2026-12-31",
};

describe("agents", () => {
  it("registers an agent, enabled", async () => {
    const { status, body } = await api.call("POST", "/v1/agents", {
      body: { id: "agt_registered_01", name: "Research agent" },
    });
    expect(status).toBe(201);
    expect(body).toEqual({
      agent: "agt_registered_01",
      name: "Research agent",
      status: "enabled",
      created_at: START.toISOString(),
    });
  });

  it("refuses an id that is already taken", async () => {
    const { agent } = await api.newAgent();
    const { status } = await api.call("POST", "/v1/agents", { body: { id: agent, name: "Again" } });
    expect(status).toBe(409);
  });

  it("refuses a malformed id", async () => {
    const { status } = await api.call("POST", "/v1/agents", {
      body: { id: "Research Agent", name: "x" },
    });
    expect(status).toBe(400);
  });

  it("lists agents and disables one", async () => {
    const { agent } = await api.newAgent();
    const disabled = await api.call("POST", `/v1/agents/${agent}/disable`);
    expect(disabled.body).toMatchObject({ agent, status: "disabled" });

    const { body } = await api.call<{ agents: { agent: string }[] }>("GET", "/v1/agents");
    expect(body.agents.map((a) => a.agent)).toContain(agent);
  });

  it("returns 404 when disabling an unknown agent", async () => {
    expect((await api.call("POST", "/v1/agents/agt_nobody/disable")).status).toBe(404);
  });

  it("is managed with the secret key only", async () => {
    const { status } = await api.call("GET", "/v1/agents", { key: KEYS.agent });
    expect(status).toBe(401);
  });
});

describe("creating mandates", () => {
  it("returns the mandate with dollar amounts, active", async () => {
    const { agent, mandate } = await api.newAgent();
    const { body } = await api.call<{ mandates: unknown[] }>("GET", `/v1/mandates?agent=${agent}`);

    expect(body.mandates).toEqual([
      {
        mandate,
        agent,
        ...USER_STORY,
        limits: { per_transaction: "5.00", per_month: "50.00", currency: "USD" },
        review_above: "2.00",
        status: "active",
        replaces: null,
        created_at: START.toISOString(),
        revoked_at: null,
      },
    ]);
  });

  it("refuses a second active mandate for the same agent", async () => {
    const { agent } = await api.newAgent();
    const { status, body } = await api.call("POST", "/v1/mandates", {
      body: { agent, ...USER_STORY },
    });
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: { code: "active_mandate_exists" } });
  });

  it("refuses a mandate for an unknown agent", async () => {
    const { status } = await api.call("POST", "/v1/mandates", {
      body: { agent: "agt_nobody", ...USER_STORY },
    });
    expect(status).toBe(404);
  });

  it("refuses per_transaction above per_month", async () => {
    const { status } = await api.call("POST", "/v1/mandates", {
      body: {
        agent: "agt_nobody",
        ...USER_STORY,
        limits: { per_transaction: "60", per_month: "50", currency: "USD" },
      },
    });
    expect(status).toBe(400);
  });

  it("has no edit endpoint", async () => {
    const { mandate } = await api.newAgent();
    const { status } = await api.call("PATCH", `/v1/mandates/${mandate}`, { body: {} });
    expect(status).toBe(404);
  });
});

describe("revoking", () => {
  it("revokes once and records when", async () => {
    const { mandate } = await api.newAgent();
    const { status, body } = await api.call("POST", `/v1/mandates/${mandate}/revoke`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ mandate, status: "revoked", revoked_at: START.toISOString() });

    const again = await api.call("POST", `/v1/mandates/${mandate}/revoke`);
    expect(again.status).toBe(409);
  });

  it("returns 404 for an unknown mandate", async () => {
    const { status } = await api.call("POST", "/v1/mandates/mnd_missing/revoke");
    expect(status).toBe(404);
  });
});

describe("replacing", () => {
  it("revokes the old mandate and creates its successor in one step", async () => {
    const { agent, mandate: old } = await api.newAgent();
    const replaced = await api.call<Mandate>("POST", `/v1/mandates/${old}/replace`, {
      body: {
        agent,
        ...USER_STORY,
        limits: { per_transaction: "10", per_month: "50", currency: "USD" },
      },
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({ status: "active", replaces: old });

    const { body } = await api.call<{ mandates: Mandate[] }>("GET", `/v1/mandates?agent=${agent}`);
    expect(body.mandates.map((m) => [m.mandate, m.status])).toEqual([
      [old, "revoked"],
      [replaced.body.mandate, "active"],
    ]);
  });

  it("judges the next request by the new limits", async () => {
    const { agent, mandate } = await api.newAgent();
    expect((await api.authorize(agent, { amount: "8" })).body.verdict).toBe("deny_limit");

    await api.call("POST", `/v1/mandates/${mandate}/replace`, {
      body: {
        agent,
        ...USER_STORY,
        limits: { per_transaction: "10", per_month: "50", currency: "USD" },
        review_above: "9",
      },
    });
    expect((await api.authorize(agent, { amount: "8" })).body.verdict).toBe("allow");
  });

  it("refuses to replace a revoked mandate", async () => {
    const { agent, mandate } = await api.newAgent();
    await api.call("POST", `/v1/mandates/${mandate}/revoke`);
    const { status } = await api.call("POST", `/v1/mandates/${mandate}/replace`, {
      body: { agent, ...USER_STORY },
    });
    expect(status).toBe(409);
  });

  it("refuses a replacement for a different agent", async () => {
    const { mandate } = await api.newAgent();
    const { agent: other } = await api.newAgent();
    const { status } = await api.call("POST", `/v1/mandates/${mandate}/replace`, {
      body: { agent: other, ...USER_STORY },
    });
    expect(status).toBe(422);
  });
});
