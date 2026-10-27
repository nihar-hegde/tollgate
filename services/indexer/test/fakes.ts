// A fake Base Sepolia and row builders. Settlements are append-only, so each
// test gets its own seller address and cursor stream instead of a clean table.

import { randomBytes } from "node:crypto";
import { createDb, deliveries, type Db } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { newId } from "@tollgate/shared";
import { getAddress, type Address, type Hex } from "viem";
import { afterAll, beforeAll } from "vitest";
import type { Chain, Transfer } from "../src/chain";
import { createIndexer } from "../src/indexer";

export const BUYER = getAddress("0xaC907cE6C87aFE02E9995dAe8cAe194cffee3550");
export const NOW = new Date("2026-10-28T12:00:00.000Z");

export const hex32 = (): Hex => `0x${randomBytes(32).toString("hex")}`;
const address = (): Address => getAddress(`0x${randomBytes(20).toString("hex")}`);

export function fakeChain() {
  const chain = {
    head: 0n,
    transfers: [] as Transfer[],
    reads: [] as [bigint, bigint][],
    failAt: null as bigint | null,
  };
  const client: Chain = {
    head: () => Promise.resolve(chain.head),
    transfersTo: (recipient, fromBlock, toBlock) => {
      if (chain.failAt !== null && fromBlock <= chain.failAt && chain.failAt <= toBlock) {
        return Promise.reject(new Error("RPC Request failed."));
      }
      chain.reads.push([fromBlock, toBlock]);
      return Promise.resolve(
        chain.transfers.filter(
          (t) => t.to === recipient && t.blockNumber >= fromBlock && t.blockNumber <= toBlock,
        ),
      );
    },
  };
  return { chain, client };
}

export function useWorld() {
  let db: Db;
  beforeAll(() => {
    db = createDb(testDatabaseUrl("indexer"));
  });
  afterAll(() => db.$client.end());

  // A seller of its own, watched from block 1000 with 5 confirmations and 200-block reads.
  function newSeller() {
    const seller = address();
    const { chain, client } = fakeChain();
    const stream = `test-${seller}`;
    const options = { seller, stream, startBlock: 1000n, confirmations: 5n, blockRange: 200n };
    const indexer = () => createIndexer({ db, chain: client, now: () => NOW, ...options });

    // An x402 payment to this seller: a Transfer with an EIP-3009 nonce, unless overridden.
    function pay(blockNumber: bigint, overrides: Partial<Transfer> = {}): Transfer {
      const transfer: Transfer = {
        txHash: hex32(),
        logIndex: 2,
        blockNumber,
        from: BUYER,
        to: seller,
        value: 10_000n,
        authorizationNonce: hex32(),
        ...overrides,
      };
      chain.transfers.push(transfer);
      return transfer;
    }

    // What the seller writes when it accepts a verdict: pending, settled or failed.
    async function accepted(overrides: Partial<typeof deliveries.$inferInsert> = {}) {
      const [row] = await db
        .insert(deliveries)
        .values({
          id: newId("delivery"),
          decisionId: newId("decision"),
          verdictNonce: newId("nonce"),
          mandateId: newId("mandate"),
          agentId: "agt_research_01",
          amount: 10_000n,
          recipient: seller,
          resource: "GET /v1/insight",
          verdictToken: "header.payload.signature",
          payer: BUYER,
          authorizationNonce: hex32(),
          createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          ...overrides,
        })
        .returning();
      if (!row) throw new Error("delivery insert returned nothing");
      return row;
    }

    return { seller, chain, indexer, pay, accepted };
  }

  return { db: () => db, newSeller };
}

export function settledLike(transfer: Transfer) {
  return {
    status: "settled" as const,
    txHash: transfer.txHash,
    authorizationNonce: transfer.authorizationNonce,
    completedAt: NOW,
  };
}
