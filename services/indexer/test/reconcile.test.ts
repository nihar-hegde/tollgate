import { describe, expect, it } from "vitest";
import { CONFIRMATION_GRACE_MS, reconcile } from "../src/reconcile";
import { hex32, NOW, settledLike, useWorld } from "./fakes";

const world = useWorld();

async function reconciled(seller: string, now = NOW) {
  const result = await reconcile(world.db(), seller, now);
  return {
    confirmed: result.confirmed.map((m) => m.delivery.id),
    unconfirmed: result.unconfirmed.map((d) => d.id),
    unexpected: result.unexpected.map((s) => s.txHash),
    mismatched: result.mismatched.map((m) => [m.delivery.id, m.problem]),
  };
}

describe("reconciliation", () => {
  it("confirms a settled delivery the chain agrees with", async () => {
    const { seller, chain, indexer, pay, accepted } = world.newSeller();
    const delivery = await accepted(settledLike(pay(1010n)));
    chain.head = 1100n;
    await indexer().catchUp();

    expect(await reconciled(seller)).toEqual({
      confirmed: [delivery.id],
      unconfirmed: [],
      unexpected: [],
      mismatched: [],
    });
  });

  it("lists USDC that arrived with no verdict behind it: paid without a decision", async () => {
    const { seller, chain, indexer, pay } = world.newSeller();
    const direct = pay(1010n, { authorizationNonce: null });
    chain.head = 1100n;
    await indexer().catchUp();

    expect((await reconciled(seller)).unexpected).toEqual([direct.txHash]);
  });

  it("lists an accepted delivery that never reached the chain, once the grace period is over", async () => {
    const { seller, accepted } = world.newSeller();
    const justNow = new Date(NOW.getTime() - CONFIRMATION_GRACE_MS + 1000);
    const settled = await accepted({
      status: "settled",
      txHash: hex32(),
      completedAt: NOW,
      createdAt: new Date(0),
    });
    const pending = await accepted({ createdAt: new Date(0) });
    await accepted({ createdAt: justNow });
    await accepted({
      status: "failed",
      failure: "insufficient_funds",
      completedAt: NOW,
      createdAt: new Date(0),
    });

    expect((await reconciled(seller)).unconfirmed.sort()).toEqual([settled.id, pending.id].sort());
  });

  it("flags a transfer that disagrees with the seller's record", async () => {
    const { seller, chain, indexer, pay, accepted } = world.newSeller();
    const short = await accepted(settledLike(pay(1010n, { value: 9_999n })));
    const paidButFailed = pay(1020n);
    const failed = await accepted({
      status: "failed",
      failure: "timeout",
      completedAt: NOW,
      authorizationNonce: paidButFailed.authorizationNonce,
    });
    chain.head = 1100n;
    await indexer().catchUp();

    expect((await reconciled(seller)).mismatched).toEqual([
      [short.id, "seller expected 10000 base units, chain shows 9999"],
      [failed.id, "seller recorded failed, but it was paid"],
    ]);
  });
});
