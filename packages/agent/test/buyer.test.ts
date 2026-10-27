import { toBaseUnits } from "@tollgate/shared";
import { describe, expect, it } from "vitest";
import { useWorld } from "./world";

const world = useWorld();
const insight = () => `${world.sellerUrl}/v1/insight?topic=usdc`;
const report = () => `${world.sellerUrl}/v1/report?topic=usdc`;
const purchase = (url: string) => ({ url, maxAmount: toBaseUnits("5"), category: "data" });

describe("an allowed purchase", () => {
  it("learns the price, gets an allow, pays with a signed payment and gets the data", async () => {
    const { agent } = await world.newAgent();
    const outcome = await world.buyerFor(agent).payAndFetch(purchase(insight()));

    expect(outcome).toMatchObject({
      status: "delivered",
      txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) as string,
      data: { data: "Sample insight on usdc." },
    });
    // verify passing means the EIP-3009 signature recovered to the wallet, for exactly $0.01 to the seller.
    expect(world.facilitator.calls).toEqual(["verify", "settle"]);

    if (outcome.status !== "delivered") return;
    await expect
      .poll(() => world.deliveryOf(outcome.decision))
      .toEqual([
        expect.objectContaining({
          status: "settled",
          txHash: outcome.txHash,
          // Read from the signed payment, so the indexer can find this transfer on-chain.
          payer: world.wallet.address,
          authorizationNonce: expect.stringMatching(/^0x[0-9a-f]{64}$/) as string,
        }),
      ]);
  });
});

describe("a purchase that needs a human", () => {
  it("waits on review, then pays with the approval once the operator approves", async () => {
    const { agent } = await world.newAgent();
    const buyer = world.buyerFor(agent);

    const asked = await buyer.payAndFetch(purchase(report()));
    expect(asked).toMatchObject({
      status: "review",
      reason: "amount 3.00 exceeds review_above 2.00",
    });
    if (asked.status !== "review") return;
    expect(world.facilitator.calls).toEqual([]);
    expect(await buyer.resume(report(), asked.decision)).toMatchObject({ status: "review" });

    const { review } = (await world.admin("GET", `/v1/decisions/${asked.decision}`)) as {
      review: { review: string };
    };
    await world.admin("POST", `/v1/reviews/${review.review}/approve`);

    const paid = await buyer.resume(report(), asked.decision);
    expect(paid).toMatchObject({ status: "delivered", data: { data: "Sample report on usdc." } });
    expect(paid.status === "delivered" && paid.decision).not.toBe(asked.decision);
  });

  it("refuses to pay once the review was denied", async () => {
    const { agent } = await world.newAgent();
    const buyer = world.buyerFor(agent);
    const asked = await buyer.payAndFetch(purchase(report()));
    if (asked.status !== "review") throw new Error("expected a review");

    const { review } = (await world.admin("GET", `/v1/decisions/${asked.decision}`)) as {
      review: { review: string };
    };
    await world.admin("POST", `/v1/reviews/${review.review}/deny`);

    expect(await buyer.resume(report(), asked.decision)).toEqual({
      status: "refused",
      reason: `review ${asked.decision} is denied`,
    });
  });
});

describe("a denied purchase", () => {
  it("returns the verdict and reason and never calls the seller with a payment", async () => {
    const { agent } = await world.newAgent();
    const outcome = await world
      .buyerFor(agent)
      .payAndFetch({ ...purchase(insight()), category: "travel" });

    expect(outcome).toMatchObject({
      status: "denied",
      verdict: "deny_category",
      reason: "category travel not in mandate (data)",
    });
    expect(world.facilitator.calls).toEqual([]);
  });
});

describe("failing closed: nothing is paid", () => {
  it("when the authorizer is down", async () => {
    const { agent } = await world.newAgent();
    const buyer = world.buyerFor(agent, { authorizerUrl: "http://localhost:1" });

    const outcome = await buyer.payAndFetch(purchase(insight()));
    expect(outcome.status).toBe("refused");
    expect(outcome.status === "refused" && outcome.reason).toMatch(
      /^authorizer unreachable, so no payment/,
    );
    expect(world.facilitator.calls).toEqual([]);
  });

  it("when the authorizer rejects the agent's key", async () => {
    const { agent } = await world.newAgent();
    const buyer = world.buyerFor(agent, { agentKey: `ak_local_${"0".repeat(32)}` });
    expect(await buyer.payAndFetch(purchase(insight()))).toEqual({
      status: "refused",
      reason: "authorizer answered 401, so no payment",
    });
  });

  it("when the price is above what the model will pay", async () => {
    const { agent } = await world.newAgent();
    const outcome = await world
      .buyerFor(agent)
      .payAndFetch({ ...purchase(report()), maxAmount: toBaseUnits("1") });
    expect(outcome).toEqual({ status: "refused", reason: "price 3.00 is above maxAmount 1.00" });
  });

  it("when the seller doesn't take the buyer's USDC", async () => {
    const { agent } = await world.newAgent();
    const buyer = world.buyerFor(agent, { asset: "0x0000000000000000000000000000000000000001" });
    expect(await buyer.payAndFetch(purchase(insight()))).toEqual({
      status: "refused",
      reason: "the seller doesn't accept USDC on Base Sepolia",
    });
  });

  it("when the URL doesn't ask for payment", async () => {
    const { agent } = await world.newAgent();
    const outcome = await world.buyerFor(agent).payAndFetch(purchase(`${world.sellerUrl}/health`));
    expect(outcome).toMatchObject({
      status: "refused",
      reason: expect.stringMatching(/got 200$/) as string,
    });
  });

  it("when the seller refuses the verdict, and says which check failed", async () => {
    const { agent, mandate } = await world.newAgent();
    world.operatorMandates.delete(mandate);

    const outcome = await world.buyerFor(agent).payAndFetch(purchase(insight()));
    expect(outcome).toEqual({
      status: "refused",
      reason: `seller refused the verdict (claims): mandate ${mandate} is not registered with this seller`,
    });
    expect(world.facilitator.calls).toEqual([]);
  });

  it("when the facilitator rejects the payment", async () => {
    const { agent } = await world.newAgent();
    world.facilitator.reject = "insufficient_funds";

    expect(await world.buyerFor(agent).payAndFetch(purchase(insight()))).toEqual({
      status: "refused",
      reason: "payment failed (402): insufficient_funds",
    });
    expect(world.facilitator.calls).toEqual(["verify"]);
  });
});
