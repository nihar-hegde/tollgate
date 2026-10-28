import { decisions } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { newId } from "@tollgate/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/export/route";
import { SELLER, startAuthorizer } from "./harness";

const api = startAuthorizer();

beforeAll(() => {
  process.env.DATABASE_URL = testDatabaseUrl("console");
});

async function exported(query: string) {
  const response = GET(new Request(`http://localhost/api/export?${query}`));
  const text = await response.text();
  return {
    response,
    lines: text
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("NDJSON export", () => {
  it("is one decision per line with Saifuro's field names and the signed token", async () => {
    const { agent } = await api.newAgent();
    const paid = await api.authorize(agent);
    const txHash = await api.paidAndIndexed(paid, agent);

    const { response, lines } = await exported(`agent=${agent}`);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="tollgate-decisions-/,
    );
    expect(lines).toEqual([
      expect.objectContaining({
        decision: paid.decision,
        request: expect.objectContaining({
          agent,
          amount: "0.01",
          currency: "USD",
          recipient: SELLER,
        }) as object,
        verdict: "allow",
        nonce: paid.nonce,
        verdict_token: expect.stringMatching(/^eyJ/) as string,
        payment: expect.objectContaining({ status: "settled", tx_hash: txHash }) as object,
      }),
    ]);
  });

  it("filters by verdict", async () => {
    const { agent } = await api.newAgent();
    await api.authorize(agent);
    await api.authorize(agent, { category: "travel" });
    const { lines } = await exported(`agent=${agent}&verdict=deny_category`);
    expect(lines.map((l) => l.verdict)).toEqual(["deny_category"]);
  });

  it("streams past one batch, oldest first, with no row missing or repeated", async () => {
    const agent = `agt_export_${Date.now()}`;
    const start = Date.UTC(2026, 0, 1);
    const rows = Array.from({ length: 501 }, (_, i) => ({
      id: newId("decision"),
      agentId: agent,
      amount: 10_000n,
      currency: "USD",
      recipient: SELLER,
      category: "data",
      verdict: "deny_no_mandate" as const,
      reason: `unknown agent ${agent}`,
      policyVersion: "pol_test.1",
      nonce: newId("nonce"),
      mode: "enforce" as const,
      issuedAt: new Date(start + i * 1000),
      verdictToken: "header.payload.signature",
    }));
    await api.world.db.insert(decisions).values(rows);

    const { lines } = await exported(`agent=${agent}`);
    expect(lines.map((l) => l.decision)).toEqual(rows.map((r) => r.id));
  });
});
