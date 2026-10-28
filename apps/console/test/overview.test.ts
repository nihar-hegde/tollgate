import { deliveries } from "@tollgate/db";
import { newId } from "@tollgate/shared";
import { describe, expect, it } from "vitest";
import { reconciliation, spendByAgent, verdictCounts } from "@/lib/overview";
import { SELLER, startAuthorizer } from "./harness";

const api = startAuthorizer();
const DAY = 24 * 60 * 60 * 1000;

describe("the overview", () => {
  it("adds up settled spend per agent, today and over 30 days, against its limit", async () => {
    const { agent } = await api.newAgent();
    const now = new Date();
    const settled = (amount: bigint, createdAt: Date, status: "settled" | "failed" = "settled") =>
      api.world.db.insert(deliveries).values({
        id: newId("delivery"),
        decisionId: newId("decision"),
        verdictNonce: newId("nonce"),
        mandateId: "mnd_test",
        agentId: agent,
        amount,
        recipient: SELLER,
        resource: "GET /v1/insight",
        verdictToken: "header.payload.signature",
        status,
        ...(status === "settled"
          ? { txHash: `0x${newId("nonce").slice(2)}${"0".repeat(32)}` }
          : { failure: "insufficient_funds" }),
        completedAt: createdAt,
        createdAt,
      });
    await settled(10_000n, now);
    await settled(2_000_000n, new Date(now.getTime() - 10 * DAY));
    await settled(5_000_000n, new Date(now.getTime() - 31 * DAY));
    await settled(1_000_000n, now, "failed");

    const row = (await spendByAgent(api.world.db, now)).find((r) => r.agent === agent);
    expect(row).toEqual({
      agent,
      status: "enabled",
      today: 10_000n,
      last30Days: 2_010_000n,
      perMonth: 50_000_000n,
      waitingReviews: 0,
    });
  });

  it("counts a waiting review against its agent", async () => {
    const { agent } = await api.newAgent();
    await api.authorize(agent, { amount: "3" });
    const row = (await spendByAgent(api.world.db, new Date())).find((r) => r.agent === agent);
    expect(row?.waitingReviews).toBe(1);
  });

  it("counts verdicts", async () => {
    const since = new Date(Date.now() - 1000);
    const { agent } = await api.newAgent();
    await api.authorize(agent);
    await api.authorize(agent, { category: "travel" });

    const counts = Object.fromEntries(
      (await verdictCounts(api.world.db, since)).map((v) => [v.verdict, v.count]),
    );
    expect(counts.allow).toBeGreaterThanOrEqual(1);
    expect(counts.deny_category).toBeGreaterThanOrEqual(1);
  });

  it("shows the indexer's reconciliation for the configured seller", async () => {
    const { agent } = await api.newAgent();
    const paid = await api.authorize(agent);
    const txHash = await api.paidAndIndexed(paid, agent);

    process.env.SELLER_ADDRESS = SELLER;
    const chain = await reconciliation(api.world.db, new Date());
    expect(chain?.confirmed.map((m) => m.settlement.txHash)).toContain(txHash);

    delete process.env.SELLER_ADDRESS;
    expect(await reconciliation(api.world.db, new Date())).toBeNull();
  });
});
