import { AgentId, EvmAddress } from "@tollgate/shared";
import type { Hex } from "viem";
import { z } from "zod";

const Env = z.object({
  // Testnet guard: refuse to sign for any chain but Base Sepolia.
  CHAIN_ID: z.literal("84532"),
  AUTHORIZER_URL: z.url().default("http://localhost:4000"),
  AUTHORIZER_AGENT_KEY: z
    .string({ error: "missing; run `pnpm --filter @tollgate/authorizer keygen`" })
    .regex(/^ak_local_[0-9a-f]{32}$/),
  AGENT_ID: AgentId.default("agt_research_01"),
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters")
    .transform((value) => value as Hex),
  USDC_ADDRESS: EvmAddress,
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid agent config:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    authorizerUrl: e.AUTHORIZER_URL,
    agentKey: e.AUTHORIZER_AGENT_KEY,
    agent: e.AGENT_ID,
    privateKey: e.AGENT_PRIVATE_KEY,
    asset: e.USDC_ADDRESS,
  };
}
