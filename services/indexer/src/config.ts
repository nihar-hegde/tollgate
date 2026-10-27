import { EvmAddress } from "@tollgate/shared";
import type { Address } from "viem";
import { z } from "zod";

const Blocks = z.coerce.bigint().nonnegative();

const Env = z.object({
  DATABASE_URL: z.url(),
  // Testnet guard: refuse to index any chain but Base Sepolia.
  CHAIN_ID: z.literal("84532"),
  RPC_URL: z.url(),
  USDC_ADDRESS: EvmAddress,
  SELLER_ADDRESS: EvmAddress,
  INDEXER_URL: z.url().default("http://localhost:4002"),
  // Without it, a first run starts at the current head and only sees new transfers.
  INDEXER_START_BLOCK: Blocks.optional(),
  INDEXER_CONFIRMATIONS: Blocks.default(5n),
  INDEXER_BLOCK_RANGE: Blocks.positive().max(200n).default(200n),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(5000),
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid indexer config:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    rpcUrl: e.RPC_URL,
    usdc: e.USDC_ADDRESS as Address,
    seller: e.SELLER_ADDRESS as Address,
    url: e.INDEXER_URL,
    port: Number(new URL(e.INDEXER_URL).port || 80),
    startBlock: e.INDEXER_START_BLOCK,
    confirmations: e.INDEXER_CONFIRMATIONS,
    blockRange: e.INDEXER_BLOCK_RANGE,
    pollMs: e.INDEXER_POLL_MS,
  };
}
