import { createDb } from "@tollgate/db";
import express from "express";
import { baseSepoliaChain } from "./chain";
import { loadConfig } from "./config";
import { createIndexer } from "./indexer";

const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
const chain = baseSepoliaChain(config.rpcUrl, config.usdc);

const indexer = createIndexer({
  db,
  chain,
  seller: config.seller,
  startBlock: config.startBlock ?? (await chain.head()),
  confirmations: config.confirmations,
  blockRange: config.blockRange,
  now: () => new Date(),
});

let lastError: string | null = null;

// Polls one pass at a time; an RPC error is logged and the next pass retries the same range.
let timer: NodeJS.Timeout | undefined;
async function poll() {
  try {
    const stored = await indexer.catchUp();
    lastError = null;
    if (stored > 0)
      console.log(`stored ${stored} transfer(s), up to block ${await indexer.lastBlock()}`);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error(`indexer pass failed: ${lastError}`);
  }
  timer = setTimeout(() => void poll(), config.pollMs);
}

const app = express();
// Reads the cursor each time, so a long catch-up shows its progress.
app.get("/health", async (_req, res) => {
  res.status(lastError ? 503 : 200).json({
    status: lastError ? "failing" : "ok",
    last_block: (await indexer.lastBlock()).toString(),
    error: lastError,
  });
});

const startsAt = (await indexer.lastBlock()) + 1n;
const server = app.listen(config.port, () => {
  console.log(`indexer on ${config.url} · watching ${config.seller} from block ${startsAt}`);
  void poll();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(timer);
    server.close(() => void db.$client.end());
  });
}
