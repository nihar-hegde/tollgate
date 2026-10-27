import { chainCursors, deliveries, settlements, type Db, type Transaction } from "@tollgate/db";
import { and, eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Chain, Transfer } from "./chain";

export type IndexerOptions = {
  db: Db;
  chain: Chain;
  seller: Address;
  // Where a first run starts; after that the cursor decides.
  startBlock: bigint;
  // A block is read once this many blocks sit on top of it, so a short reorg can't undo it.
  confirmations: bigint;
  // The public Base Sepolia RPC refuses getLogs over more than 200 blocks.
  blockRange: bigint;
  now: () => Date;
  stream?: string;
};

export function createIndexer(options: IndexerOptions) {
  const { db, chain, seller, confirmations, blockRange, now } = options;
  const stream = options.stream ?? "usdc-to-seller";

  // Reads every confirmed block not read yet. Returns how many transfers it stored.
  async function catchUp(): Promise<number> {
    const confirmed = (await chain.head()) - confirmations;
    let next = (await lastBlock()) + 1n;
    let stored = 0;

    while (next <= confirmed) {
      const to = next + blockRange - 1n < confirmed ? next + blockRange - 1n : confirmed;
      const transfers = await chain.transfersTo(seller, next, to);
      await record(transfers, to);
      stored += transfers.length;
      next = to + 1n;
    }
    return stored;
  }

  async function lastBlock(): Promise<bigint> {
    const [cursor] = await db.select().from(chainCursors).where(eq(chainCursors.stream, stream));
    return cursor?.lastBlock ?? options.startBlock - 1n;
  }

  // One transaction per range: transfers and cursor move together, so a crash just re-reads the range.
  async function record(transfers: Transfer[], toBlock: bigint): Promise<void> {
    await db.transaction(async (tx) => {
      if (transfers.length > 0) {
        await tx.insert(settlements).values(transfers.map(toRow)).onConflictDoNothing();
      }
      for (const transfer of transfers) await settleFromChain(tx, transfer, now());

      const cursor = { lastBlock: toBlock, updatedAt: now() };
      await tx
        .insert(chainCursors)
        .values({ stream, ...cursor })
        .onConflictDoUpdate({ target: chainCursors.stream, set: cursor });
    });
  }

  return { catchUp, lastBlock };
}

// A delivery the seller accepted but never completed (say it crashed): the chain shows it was paid.
async function settleFromChain(tx: Transaction, transfer: Transfer, now: Date): Promise<void> {
  const { txHash, authorizationNonce } = toRow(transfer);
  if (authorizationNonce === null || authorizationNonce === undefined) return;
  await tx
    .update(deliveries)
    .set({ status: "settled", txHash, completedAt: now })
    .where(
      and(
        eq(deliveries.status, "pending"),
        eq(deliveries.authorizationNonce, authorizationNonce),
        eq(deliveries.amount, transfer.value),
        sql`lower(${deliveries.payer}) = lower(${transfer.from})`,
      ),
    );
}

function toRow(transfer: Transfer): typeof settlements.$inferInsert {
  return {
    txHash: transfer.txHash.toLowerCase(),
    logIndex: transfer.logIndex,
    blockNumber: transfer.blockNumber,
    fromAddress: transfer.from,
    toAddress: transfer.to,
    value: transfer.value,
    authorizationNonce: transfer.authorizationNonce?.toLowerCase() ?? null,
  };
}
