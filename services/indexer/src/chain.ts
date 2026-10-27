import { createPublicClient, http, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

export type Transfer = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  to: Address;
  value: bigint;
  // The EIP-3009 nonce from the same transaction's AuthorizationUsed event; null for a direct transfer.
  authorizationNonce: Hex | null;
};

// What the indexer needs from Base Sepolia, so tests can swap in a fake chain.
export type Chain = {
  head(): Promise<bigint>;
  transfersTo(recipient: Address, fromBlock: bigint, toBlock: bigint): Promise<Transfer[]>;
};

const [TRANSFER, AUTHORIZATION_USED] = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

export function baseSepoliaChain(rpcUrl: string, usdc: Address): Chain {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // An x402 payment is one transferWithAuthorization: the receipt holds the nonce next to the Transfer.
  async function authorizationNonce(txHash: Hex, from: Address): Promise<Hex | null> {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const used = parseEventLogs({
      abi: [AUTHORIZATION_USED],
      logs: receipt.logs.filter((log) => sameAddress(log.address, usdc)),
    }).find((event) => sameAddress(event.args.authorizer, from));
    return used?.args.nonce ?? null;
  }

  return {
    head: () => client.getBlockNumber(),
    async transfersTo(recipient, fromBlock, toBlock) {
      const logs = await client.getLogs({
        address: usdc,
        event: TRANSFER,
        args: { to: recipient },
        fromBlock,
        toBlock,
        strict: true,
      });
      return Promise.all(
        logs.map(async (log) => ({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          from: log.args.from,
          to: log.args.to,
          value: log.args.value,
          authorizationNonce: await authorizationNonce(log.transactionHash, log.args.from),
        })),
      );
    },
  };
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
