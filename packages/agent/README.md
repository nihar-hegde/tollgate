# packages/agent

The buyer: an AI agent that asks permission before it pays. The same buyer runs two ways: as a **CLI**, and as an **MCP server**, so Claude (or any MCP client) can buy data from the seller.

Real-world role: an employee with a company card who must get approval before each purchase.

## The flow of one paid call

```
1. GET the URL, no payment        → 402 with the exact price and payTo
2. POST /v1/authorizations        → a signed decision for exactly that amount
3. allow: sign EIP-3009, retry    → the seller checks the verdict, x402 settles
4. Return the data and tx hash
```

In detail (`src/buyer.ts`):

1. **Discover the price.** Call the seller with no payment. The `402`'s `PAYMENT-REQUIRED` header gives the amount in base units (`10000`), the network, the USDC asset and `payTo`. The buyer only takes an `exact` option on `eip155:84532` in the USDC it was configured with (the address compared regardless of letter case). Free; nothing is consumed.
2. **Check the ceiling.** A price above `maxAmount` stops here.
3. **Ask permission.** `POST /v1/authorizations` with a fresh `Idempotency-Key`, the exact price as a dollar string, `currency: "USD"`, `recipient` = `payTo` copied unchanged (the seller compares it case-sensitively), the category and `protocol: "x402"`.
4. **Act on the verdict:**
   - `allow`: sign an EIP-3009 `transferWithAuthorization` for **exactly the option that was approved** (offline, no money moves yet), then send one paid request with the x402 `PAYMENT-SIGNATURE` header plus `X-Verdict: <verdict_token>`.
   - `review`: return `{ status: "review", decision }` and stop. `resume(url, decision)` later checks whether the operator approved. If so, it re-reads the 402, makes sure the price and `payTo` still match the approval, and pays with the approval's token.
   - any `deny_*`: return the verdict and reason. The seller is never called with a payment.
5. **Report.** Return the data, the decision id and the tx hash from the `PAYMENT-RESPONSE` header. The seller records the same link in its `deliveries` table (ADR 0005), so the console can trace it.

The buyer uses `x402Client` directly rather than the `@x402/fetch` wrapper, because the wrapper signs whatever a 402 asks for. x402's client-side $1 cap is turned off; the buyer's own rule is stricter (exactly the approved amount, to exactly the approved payee). ADR 0006.

## Outcomes

| `status`    | Meaning                                                    | Paid?                                        |
| ----------- | ---------------------------------------------------------- | -------------------------------------------- |
| `delivered` | data, `decision`, `txHash`                                 | yes                                          |
| `review`    | waiting for an operator; `decision` is the review decision | no                                           |
| `denied`    | `verdict` and `reason` from the authorizer                 | no                                           |
| `refused`   | the buyer stopped, failing closed; `reason` says why       | no, unless `reason` says it may have settled |

## Fail closed

No verdict, no payment. Each of these returns `refused` without signing anything or sending a payment:

- the authorizer is down, times out (10 s), or answers anything but `200`;
- the price is above `maxAmount`, the URL doesn't answer `402`, or the seller doesn't take Base Sepolia USDC;
- the review was denied or expired, or the price changed while it waited.

After a payment has been sent, the outcome reports what the seller said:

- `refused` with the failed check on a `403`;
- `refused` with the facilitator's reason on a `402`, when the payment itself failed.

If the seller answers with a 5xx or never answers, the reason says the payment **may still have settled** and names the decision, so nobody retries blindly. A paid response with a malformed `PAYMENT-RESPONSE` header is still `delivered`, with `txHash: null`.

## CLI

```sh
pnpm --filter @tollgate/agent buy "http://localhost:4001/v1/insight?topic=usdc"            # --max 0.05 --category data
pnpm --filter @tollgate/agent buy "http://localhost:4001/v1/report?topic=usdc" --max 5     # $3: goes to review
pnpm --filter @tollgate/agent resume "http://localhost:4001/v1/report?topic=usdc" dec_…    # after approval
```

It prints the outcome as JSON, plus the Basescan link when it paid. The exit code is 0 for `delivered` and `review` (a normal pause), and 1 for `denied` or `refused`.

## MCP server

```
pay_and_fetch(url, maxAmount, category)   buy one response; maxAmount in dollars, e.g. "0.05"
resume_purchase(url, decision)            after a review: pay with the operator's approval
```

Each tool returns the outcome above as JSON, plus a Basescan `explorer` link when it paid. Denials and refusals are ordinary answers for the model to read; only malformed input (say `maxAmount: "0.01 USD"`) is a tool error. It runs over stdio, `src/mcp-stdio.ts`, and never writes to stdout, which carries the protocol.

To use it from Claude Code, open this repo: `.mcp.json` registers `tollgate-buyer`, and Claude Code asks you to approve it. The authorizer and seller must be running. For Claude Desktop, add the same command to its config:

```json
{
  "mcpServers": {
    "tollgate-buyer": {
      "command": "pnpm",
      "args": ["--silent", "--filter", "@tollgate/agent", "mcp"],
      "cwd": "/path/to/tollgate"
    }
  }
}
```

Then ask, for example: _"Buy the market insight on usdc from http://localhost:4001/v1/insight?topic=usdc, pay at most 5 cents, category data."_

**Live check (28 Oct 2026), over the real stdio transport:**

- $0.01 delivered: tx `0x6cf390ce…fdeb`.
- The $3 report went to `review`.
- An operator approved it in the console's review queue.
- `resume_purchase` paid $3 under the approval: https://sepolia.basescan.org/tx/0x81161ee0ed291736f471bf2b36c5fa78021e87e1973b05e5ca50cf323adf0dfb

## First real paid call (27 Oct 2026)

$0.01 testnet USDC, agent `0xaC90…3550` to seller `0xC625…fcF0`, submitted by the x402.org facilitator (which paid the gas) in block 50980908, about 3 seconds end to end:
https://sepolia.basescan.org/tx/0x5565847ee8ef9bac4a2986d0ddcbeeef7bf4fa607fbd795c15ac385e461b56c3

## Wallet and gas

- A viem account on Base Sepolia holding faucet USDC. The key comes from `AGENT_PRIVATE_KEY` in `.env` (testnet only, never committed). It signs payments and nothing else.
- The facilitator submits the payment and pays gas, so the agent needs **USDC but no ETH** for x402 calls.

## Two nonces

The EIP-3009 nonce inside the signed payment is created here (by x402's `ExactEvmScheme`) and enforced on-chain by the USDC contract. It is unrelated to the verdict nonce, which comes from the authorizer and is checked by the seller.

## Tests

`test/buyer.test.ts` and `test/mcp.test.ts` run the whole loop without a chain. The **real** authorizer and the **real** seller run on random ports against `tollgate_agent_test`. A fake facilitator checks the buyer's EIP-3009 signature with viem's `verifyTypedData`, against USDC's EIP-712 domain on Base Sepolia, the way the USDC contract would. It covers the allow, review-then-approve, review-denied and denied paths, and every fail-closed branch above. The MCP tests connect an MCP client in memory: listing the tools, a paid call with its Basescan link, review → approve → `resume_purchase`, and a malformed `maxAmount` rejected before anything is paid.

## Folder plan

```
src/
  buyer.ts     createBuyer(): payAndFetch() and resume()
  cli.ts       buy / resume commands
  config.ts    env, validated with Zod (Base Sepolia only)
  index.ts       exports
  mcp.ts         createMcpServer(): pay_and_fetch and resume_purchase
  mcp-stdio.ts   the MCP server over stdio (pnpm --filter @tollgate/agent mcp)
test/
  buyer.test.ts   every outcome, against the real services
  mcp.test.ts     the same through an MCP client
  world.ts        authorizer + seller + fake facilitator
scripts/
  test-transfer.ts   Day 1: a direct 0.01 USDC transfer (this one needs ETH for gas)
```

## Config

| Variable               | Default                 |                                 |
| ---------------------- | ----------------------- | ------------------------------- |
| `CHAIN_ID`             |                         | must be `84532` (testnet guard) |
| `AGENT_PRIVATE_KEY`    |                         | testnet key                     |
| `USDC_ADDRESS`         |                         | the only asset it will pay in   |
| `AUTHORIZER_URL`       | `http://localhost:4000` |                                 |
| `AUTHORIZER_AGENT_KEY` |                         | from the authorizer's `keygen`  |
| `AGENT_ID`             | `agt_research_01`       | who the agent asks for          |

## Built on

Day 1 (transfer script), Day 5 (the end-to-end paid call), Day 8 (MCP server driven from Claude).
