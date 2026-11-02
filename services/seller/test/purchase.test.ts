import { toBaseUnits, VERDICT_HEADER } from "@tollgate/shared";
import { describe, expect, it } from "vitest";
import { useSeller, BUYER, settlementIn, USDC } from "./harness";
import { later, SELLER } from "./issuer";

const seller = useSeller();
const INSIGHT = "/v1/insight?topic=usdc";

describe("an unpaid request", () => {
  it("gets a 402 with the exact price, asset, network and payTo", async () => {
    const required = await seller.priceOf(INSIGHT);
    expect(required.accepts).toEqual([
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "10000",
        asset: USDC,
        payTo: SELLER,
        maxTimeoutSeconds: expect.any(Number) as number,
        extra: { name: "USDC", version: "2" },
      },
    ]);
  });

  it("prices the report at $3, above the review threshold", async () => {
    const [option] = (await seller.priceOf("/v1/report")).accepts;
    expect(option?.amount).toBe(toBaseUnits("3").toString());
  });

  it("never checks or consumes a verdict, even one sent along", async () => {
    const verdict = await seller.sign();
    const unpaid = await seller.get(INSIGHT, { [VERDICT_HEADER]: verdict });
    expect(unpaid.status).toBe(402);
    expect(seller.facilitator.calls).toEqual([]);
    expect(await seller.deliveryOf(verdict)).toEqual([]);

    expect((await seller.buy(INSIGHT, verdict)).status).toBe(200);
  });
});

describe("a paid request with a valid verdict", () => {
  it("is verified, delivered, settled, and recorded with the transaction", async () => {
    const verdict = await seller.sign();
    const { status, headers, body } = await seller.buy(INSIGHT, verdict);

    expect(status).toBe(200);
    expect(body).toMatchObject({ resource: "GET /v1/insight", data: "Sample insight on usdc." });
    expect(seller.facilitator.calls).toEqual(["verify", "settle"]);

    const settlement = settlementIn(headers);
    expect(settlement.success).toBe(true);
    await expect
      .poll(() => seller.deliveryOf(verdict))
      .toEqual([
        expect.objectContaining({
          id: body.delivery,
          decisionId: body.decision,
          status: "settled",
          txHash: settlement.transaction,
          payer: BUYER,
          authorizationNonce: expect.stringMatching(/^0x[0-9a-f]{64}$/) as string,
          amount: 10000n,
          recipient: SELLER,
          resource: "GET /v1/insight",
          verdictToken: verdict,
        }),
      ]);
  });
});

describe("a paid request is refused before the facilitator sees it", () => {
  const sign = seller.sign;

  it.each([
    ["no verdict", () => Promise.resolve(null), "signature"],
    ["an edited verdict", async () => `${await sign()}x`, "signature"],
    [
      "an expired verdict",
      () => sign({ iat: later(-301).getTime() / 1000, exp: later(-1).getTime() / 1000 }),
      "expiry",
    ],
    ["a sandbox verdict", () => seller.signAsSandbox(), "environment"],
    ["a review verdict", () => sign({ verdict: "review" }), "claims"],
    ["a $3 approval for a $0.01 call", () => sign({ request: { amount: "3" } }), "claims"],
    ["an approval for another seller", () => sign({ request: { recipient: BUYER } }), "claims"],
    ["another operator's mandate", () => sign({ mandate: "mnd_other" }), "claims"],
  ] as const)("refuses %s", async (_case, makeVerdict, check) => {
    const verdict = await makeVerdict();
    const { status, body } = await seller.buy(INSIGHT, verdict);

    expect(status).toBe(403);
    expect(body.error).toMatchObject({ code: "verdict_rejected", check });
    expect(body.data).toBeUndefined();
    expect(seller.facilitator.calls).toEqual([]);
    if (verdict?.includes(".")) expect(await seller.deliveryOf(verdict)).toEqual([]);
  });

  it("refuses a replayed verdict and names the nonce", async () => {
    const verdict = await sign({ nonce: "n_used_once" });
    expect((await seller.buy(INSIGHT, verdict)).status).toBe(200);

    const replay = await seller.buy(INSIGHT, verdict);
    expect(replay.status).toBe(403);
    expect(replay.body.error).toEqual({
      code: "verdict_rejected",
      check: "nonce",
      message: "verdict nonce n_used_once was already used",
    });
    expect(seller.facilitator.calls).toEqual([]);
  });

  it("accepts a verdict sent five times at once exactly once", async () => {
    const verdict = await sign();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => seller.buy(INSIGHT, verdict)),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 403, 403, 403, 403]);
    expect(await seller.deliveryOf(verdict)).toHaveLength(1);
  });

  it("refuses a second approval of the same review", async () => {
    const first = await sign({ supersedes: "dec_reviewed_once" });
    const second = await sign({ supersedes: "dec_reviewed_once" });
    expect((await seller.buy(INSIGHT, first)).status).toBe(200);

    const { status, body } = await seller.buy(INSIGHT, second);
    expect(status).toBe(403);
    expect(body.error).toMatchObject({
      check: "nonce",
      message: "review dec_reviewed_once was already paid for with another approval",
    });
  });
});

describe("when the payment itself fails", () => {
  it("delivers nothing if the facilitator rejects the payment, and the verdict stays used", async () => {
    seller.facilitator.verify = { isValid: false, invalidReason: "insufficient_funds" };
    const verdict = await seller.sign();

    const { status, body } = await seller.buy(INSIGHT, verdict);
    expect(status).toBe(402);
    expect(body.data).toBeUndefined();
    expect(seller.facilitator.calls).toEqual(["verify"]);
    await expect
      .poll(() => seller.deliveryOf(verdict))
      .toEqual([
        expect.objectContaining({ status: "failed", failure: "insufficient_funds", txHash: null }),
      ]);

    seller.facilitator.reset();
    expect((await seller.buy(INSIGHT, verdict)).body.error?.check).toBe("nonce");
  });

  it("stores the transaction hash in lowercase, as the indexer does", async () => {
    const transaction = `0x${"AB".repeat(32)}`;
    seller.facilitator.settle = { transaction };
    const verdict = await seller.sign();

    expect((await seller.buy(INSIGHT, verdict)).status).toBe(200);
    await expect
      .poll(() => seller.deliveryOf(verdict))
      .toEqual([expect.objectContaining({ txHash: transaction.toLowerCase() })]);
  });

  it("delivers nothing if settlement fails on-chain", async () => {
    seller.facilitator.settle = {
      success: false,
      errorReason: "transaction_reverted",
      transaction: "",
    };
    const verdict = await seller.sign();

    const { status, body } = await seller.buy(INSIGHT, verdict);
    expect(status).toBe(402);
    expect(body.data).toBeUndefined();
    await expect
      .poll(() => seller.deliveryOf(verdict))
      .toEqual([expect.objectContaining({ status: "failed", failure: "transaction_reverted" })]);
  });
});

describe("other routes", () => {
  it("answers health checks without payment", async () => {
    expect(await seller.get("/health")).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("returns JSON 404 for anything else", async () => {
    expect((await seller.get("/v1/unknown")).status).toBe(404);
  });
});
