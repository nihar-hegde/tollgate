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

const status = { lastBlock: await indexer.lastBlock(), lastError: null as string | null };

// Polls one pass at a time; an RPC error is logged and the next pass retries the same range.
let timer: NodeJS.Timeout | undefined;
async function poll() {
  try {
    const stored = await indexer.catchUp();
    status.lastBlock = await indexer.lastBlock();
    status.lastError = null;
    if (stored > 0) console.log(`stored ${stored} transfer(s), up to block ${status.lastBlock}`);
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    console.error(`indexer pass failed: ${status.lastError}`);
  }
  timer = setTimeout(() => void poll(), config.pollMs);
}

const app = express();
app.get("/health", (_req, res) => {
  res.status(status.lastError ? 503 : 200).json({
    status: status.lastError ? "failing" : "ok",
    last_block: status.lastBlock.toString(),
    error: status.lastError,
  });
});

const server = app.listen(config.port, () => {
  console.log(
    `indexer on ${config.url} · watching ${config.seller} from block ${status.lastBlock + 1n}`,
  );
  void poll();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(timer);
    server.close(() => void db.$client.end());
  });
}
