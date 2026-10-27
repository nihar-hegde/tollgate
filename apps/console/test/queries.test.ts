import { describe, expect, it } from "vitest";
import { getDecision, listAgentsWithMandates, listDecisions } from "@/lib/queries";
import { startAuthorizer } from "./harness";

const api = startAuthorizer();

describe("the decision log", () => {
  it("joins each decision to its delivery and on-chain settlement", async () => {
    const { agent } = await api.newAgent();
    const paid = await api.authorize(agent);
    const txHash = await api.paidAndIndexed(paid, agent);
    await api.authorize(agent, { category: "travel" });

    // Both were issued in the same second, so their order in the log isn't fixed.
    const rows = await listDecisions(api.world.db, { agent }, new Date());
    expect(rows.map((r) => [r.decision.verdict, r.trace.stage]).sort()).toEqual([
      ["allow", "confirmed"],
      ["deny_category", "denied"],
    ]);
    expect(rows.find((r) => r.decision.verdict === "allow")?.delivery?.txHash).toBe(txHash);
  });

  it("filters by verdict and by agent", async () => {
    const { agent } = await api.newAgent();
    await api.authorize(agent);
    await api.authorize(agent, { amount: "3" });

    const reviews = await listDecisions(api.world.db, { agent, verdict: "review" }, new Date());
    expect(reviews.map((r) => r.decision.verdict)).toEqual(["review"]);
  });
});

describe("one decision", () => {
  it("comes with its mandate, review and the allow that approved it", async () => {
    const { agent, mandate } = await api.newAgent();
    const asked = await api.authorize(agent, { amount: "3" });
    const { review } = await api.call<{ review: { review: string } }>(
      "GET",
      `/v1/decisions/${asked.decision}`,
      api.keys.secret,
    );
    const approval = await api.call<{ decision: string }>(
      "POST",
      `/v1/reviews/${review.review}/approve`,
      api.keys.secret,
    );

    const detail = await getDecision(api.world.db, asked.decision, new Date());
    expect(detail).toMatchObject({
      mandate: { id: mandate },
      review: { status: "approved" },
      supersededBy: approval.decision,
      trace: { stage: "approved" },
    });
  });

  it("is null for an unknown id", async () => {
    expect(await getDecision(api.world.db, "dec_missing", new Date())).toBeNull();
  });
});

describe("mandate history", () => {
  it("lists every agent with its mandates, oldest first", async () => {
    const { agent, mandate } = await api.newAgent();
    const listed = (await listAgentsWithMandates(api.world.db)).find((a) => a.agent.id === agent);
    expect(listed?.mandates.map((m) => [m.id, m.status])).toEqual([[mandate, "active"]]);
  });
});
