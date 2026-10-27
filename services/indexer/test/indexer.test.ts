import { chainCursors, deliveries, settlements } from "@tollgate/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useWorld } from "./fakes";

const world = useWorld();

async function settlementsTo(seller: string) {
  return world.db().select().from(settlements).where(eq(settlements.toAddress, seller));
}

describe("reading the chain", () => {
  it("stores a transfer only once 5 blocks sit on top of it", async () => {
    const { seller, chain, indexer, pay } = world.newSeller();
    const transfer = pay(1100n);

    chain.head = 1104n;
    expect(await indexer().catchUp()).toBe(0);
    chain.head = 1105n;
    expect(await indexer().catchUp()).toBe(1);

    expect(await settlementsTo(seller)).toEqual([
      expect.objectContaining({
        txHash: transfer.txHash,
        blockNumber: 1100n,
        fromAddress: transfer.from,
        value: 10_000n,
        authorizationNonce: transfer.authorizationNonce,
      }),
    ]);
  });

  it("reads in ranges of at most 200 blocks, with no gaps or overlaps", async () => {
    const { chain, indexer } = world.newSeller();
    chain.head = 1450n + 5n;

    await indexer().catchUp();
    expect(chain.reads).toEqual([
      [1000n, 1199n],
      [1200n, 1399n],
      [1400n, 1450n],
    ]);
  });

  it("picks up where it stopped after a restart", async () => {
    const { seller, chain, indexer, pay } = world.newSeller();
    pay(1010n);
    chain.head = 1100n;
    await indexer().catchUp();

    pay(1150n);
    chain.head = 1200n;
    chain.reads = [];
    await indexer().catchUp();

    expect(chain.reads).toEqual([[1096n, 1195n]]);
    expect(await settlementsTo(seller)).toHaveLength(2);
  });

  it("stores nothing twice when blocks are read again", async () => {
    const { seller, chain, indexer, pay } = world.newSeller();
    pay(1010n);
    chain.head = 1100n;
    await indexer().catchUp();

    // As if the cursor had been lost: everything from the start block again.
    await world
      .db()
      .delete(chainCursors)
      .where(eq(chainCursors.stream, `test-${seller}`));
    await indexer().catchUp();
    expect(await settlementsTo(seller)).toHaveLength(1);
  });

  it("keeps what it read before an RPC failure, then carries on from there", async () => {
    const { seller, chain, indexer, pay } = world.newSeller();
    pay(1100n);
    pay(1300n);
    chain.head = 1405n;
    chain.failAt = 1300n;

    await expect(indexer().catchUp()).rejects.toThrow("RPC Request failed.");
    expect(await indexer().lastBlock()).toBe(1199n);
    expect(await settlementsTo(seller)).toHaveLength(1);

    chain.failAt = null;
    expect(await indexer().catchUp()).toBe(1);
    expect(await indexer().lastBlock()).toBe(1400n);
  });

  it("only reads transfers to its own seller", async () => {
    const mine = world.newSeller();
    const other = world.newSeller();
    mine.chain.transfers.push({ ...other.pay(1010n) });
    mine.chain.head = 1100n;

    expect(await mine.indexer().catchUp()).toBe(0);
  });
});

describe("a delivery the seller never completed", () => {
  it("is settled from the chain, matched by payer and EIP-3009 nonce", async () => {
    const { chain, indexer, pay, accepted } = world.newSeller();
    const delivery = await accepted();
    const transfer = pay(1010n, {
      authorizationNonce: delivery.authorizationNonce as `0x${string}`,
    });
    chain.head = 1100n;

    await indexer().catchUp();
    const [row] = await world.db().select().from(deliveries).where(eq(deliveries.id, delivery.id));
    expect(row).toMatchObject({
      status: "settled",
      txHash: transfer.txHash,
      payer: delivery.payer,
    });
  });

  it("stays pending when the transfer is for another amount", async () => {
    const { chain, indexer, pay, accepted } = world.newSeller();
    const delivery = await accepted();
    pay(1010n, { authorizationNonce: delivery.authorizationNonce as `0x${string}`, value: 1n });
    chain.head = 1100n;

    await indexer().catchUp();
    const [row] = await world.db().select().from(deliveries).where(eq(deliveries.id, delivery.id));
    expect(row?.status).toBe("pending");
  });
});
