# packages/agent

The buyer: an AI agent that asks permission before it pays. It runs two ways:

- **CLI**, for scripts and demos.
- **MCP server** with one tool, `pay_and_fetch`, so Claude (or any MCP client) can buy data from the seller.

Real-world role: an employee with a company card who must get approval before each purchase.

## The flow of one paid call

```
1. GET the URL with no payment      → seller replies 402 with price + payTo
2. POST /v1/authorizations          → authorizer replies with a decision
3. If allow: sign payment, retry    → seller verifies verdict, x402 settles
4. Report tx hash with the decision id
```

In detail:

1. **Discover the price.** Call the seller with no payment. The `402` response gives the exact amount (e.g. `10000` base units), the USDC asset, the network (`eip155:84532`) and the seller's `payTo` address. Free; nothing is consumed.
2. **Check the ceiling.** If the price is above the tool's `maxAmount`, stop.
3. **Ask permission.** `POST /v1/authorizations` with an `Idempotency-Key`, the exact amount from the 402, `currency: "USD"`, `recipient` = the `payTo` address, the category, and `protocol: "x402"`.
4. **Act on the verdict:**
   - `allow`: sign an EIP-3009 `transferWithAuthorization` offline (no money moves yet), then retry the call with the x402 payment header and `X-Verdict: <verdict_token>`.
   - `review`: report that it's waiting for a human. After the operator approves in the console, the new `allow` (with `supersedes`) is used to retry.
   - any `deny_*`: return the reason to the model and do not call the seller.
5. **Report.** Return the tx hash from the `PAYMENT-RESPONSE` header with the decision id. The seller records the same link in its `deliveries` table (ADR 0005), so the console can trace it.

## Fail closed

If the authorizer is down, times out or returns anything unexpected: **no verdict, no payment.** There is no fallback that pays anyway.

## The MCP tool

```
pay_and_fetch(url, maxAmount, category)
```

| Argument    | Meaning                                            |
| ----------- | -------------------------------------------------- |
| `url`       | The paid endpoint to call                          |
| `maxAmount` | The most the model is willing to pay for this call |
| `category`  | Spending category to request (e.g. `data`)         |

Returns the data plus the decision id and tx hash on success, or the verdict and reason on review or denial.

## Wallet and gas

- A viem wallet on Base Sepolia, holding faucet USDC. The key comes from `AGENT_PRIVATE_KEY` in `.env` (testnet only, never committed).
- The facilitator submits the payment and pays gas, so the agent needs **USDC but no ETH** for x402 calls.
- The wallet is wrapped with `@x402/fetch`, which handles the 402 → sign → retry cycle.

## To confirm against the pinned x402 version (2.28.0)

- That `@x402/fetch` keeps custom headers (`X-Verdict`) on its retry. If not, the agent does the retry itself.

## Two nonces

The EIP-3009 nonce inside the signed payment is created here and enforced on-chain. It is unrelated to the verdict nonce, which comes from the authorizer and is checked by the seller.

## Folder plan

```
src/
  index.ts        exports
  pay-and-fetch.ts  the flow above (shared by CLI and MCP)
  cli.ts          command-line entry
  mcp.ts          MCP server exposing pay_and_fetch
test/
  pay-and-fetch.test.ts   allow / review / deny / authorizer down
```

The Day 1 script (send 0.01 USDC directly and read back the receipt and `Transfer` log) also lives here under `scripts/`. That one does need ETH for gas.

## Config

`AGENT_PRIVATE_KEY`, `RPC_URL`, `CHAIN_ID`, `USDC_ADDRESS`, `AUTHORIZER_URL`, `DATABASE_URL`.

## Built on

Day 1 (transfer script), Day 5 (end-to-end paid call), Day 8 (MCP server driven from Claude).
