// Test transfer: prove the on-chain loop by hand.
// Sends 0.01 testnet USDC from the agent wallet to the seller on Base Sepolia,
// waits for the receipt, and reads the Transfer event back out of it.
//
// This is a direct ERC-20 transfer, so the agent pays gas in ETH. Real x402
// payments later are signed off-chain and submitted by the facilitator instead.
//
// Run: pnpm --filter @tollgate/agent test-transfer

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";

// $0.01 in USDC base units (6 decimals). Integers only on money paths.
const AMOUNT = 10_000n;
const USDC_DECIMALS = 6;
const EXPLORER = "https://sepolia.basescan.org";

// isAddress is a type guard, so the refined value is already typed as Address.
const address = z.string().refine(isAddress, "not a valid address");

const env = z
  .object({
    // Testnet guard: refuse to run against any chain but Base Sepolia.
    CHAIN_ID: z.literal("84532"),
    RPC_URL: z.url(),
    USDC_ADDRESS: address,
    SELLER_ADDRESS: address,
    AGENT_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters")
      .transform((v) => v as Hex),
  })
  .parse(process.env);

const agent = privateKeyToAccount(env.AGENT_PRIVATE_KEY);
const transport = http(env.RPC_URL);
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const walletClient = createWalletClient({ account: agent, chain: baseSepolia, transport });

const usdc = { address: env.USDC_ADDRESS, abi: erc20Abi } as const;
const fmt = (units: bigint) => `${formatUnits(units, USDC_DECIMALS)} USDC`;

function usdcBalance(owner: Address) {
  return publicClient.readContract({ ...usdc, functionName: "balanceOf", args: [owner] });
}

async function preflight() {
  const chainId = await publicClient.getChainId();
  if (chainId !== baseSepolia.id) {
    throw new Error(`RPC is on chain ${chainId}, expected ${baseSepolia.id} (Base Sepolia)`);
  }

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ ...usdc, functionName: "symbol" }),
    publicClient.readContract({ ...usdc, functionName: "decimals" }),
  ]);
  if (symbol !== "USDC" || decimals !== USDC_DECIMALS) {
    throw new Error(`USDC_ADDRESS is ${symbol} with ${decimals} decimals, expected USDC with 6`);
  }

  if (agent.address.toLowerCase() === env.SELLER_ADDRESS.toLowerCase()) {
    throw new Error("Agent and seller are the same address");
  }

  const [agentUsdc, agentEth] = await Promise.all([
    usdcBalance(agent.address),
    publicClient.getBalance({ address: agent.address }),
  ]);
  if (agentUsdc < AMOUNT) {
    throw new Error(`Agent has ${fmt(agentUsdc)}, needs ${fmt(AMOUNT)}`);
  }
  if (agentEth === 0n) {
    throw new Error("Agent has no ETH for gas");
  }

  console.log(`agent   ${agent.address}  ${fmt(agentUsdc)}, ${formatEther(agentEth)} ETH`);
  console.log(`seller  ${env.SELLER_ADDRESS}  ${fmt(await usdcBalance(env.SELLER_ADDRESS))}`);
}

async function transfer() {
  // Simulate first so a revert shows up here instead of as a failed transaction.
  const { request } = await publicClient.simulateContract({
    ...usdc,
    account: agent,
    functionName: "transfer",
    args: [env.SELLER_ADDRESS, AMOUNT],
  });
  const hash = await walletClient.writeContract(request);
  console.log(`\nsent ${fmt(AMOUNT)}  tx ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted`);
  }
  console.log(`mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
  return receipt;
}

async function main() {
  await preflight();
  const receipt = await transfer();

  // Read the Transfer event back from the receipt: this is what the indexer
  // will later rely on, rather than trusting the sender's word.
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === usdc.address.toLowerCase()),
  });
  const match = transfers.find(
    (log) =>
      log.args.from.toLowerCase() === agent.address.toLowerCase() &&
      log.args.to.toLowerCase() === env.SELLER_ADDRESS.toLowerCase() &&
      log.args.value === AMOUNT,
  );
  if (!match) {
    throw new Error("Receipt has no matching USDC Transfer event");
  }

  console.log(`\nTransfer event (log index ${match.logIndex})`);
  console.log(`  from   ${match.args.from}`);
  console.log(`  to     ${match.args.to}`);
  console.log(`  value  ${match.args.value} base units (${fmt(match.args.value)})`);

  console.log(`\nseller now ${fmt(await usdcBalance(env.SELLER_ADDRESS))}`);
  console.log(`${EXPLORER}/tx/${receipt.transactionHash}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
