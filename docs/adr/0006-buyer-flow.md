# ADR 0006: Buyer flow

Status: accepted · 2026-10-27

## Context

The agent must learn the price, get a verdict for exactly that amount, and pay only on `allow`, failing closed throughout. The `@x402/fetch` wrapper makes its own unpaid call and signs whatever the 402 asks for, and x402's client caps payments at $1 by default. Saifuro's guidance is to fail closed when no verdict is available.

## Decision

1. **The buyer drives x402 itself.** One unpaid call reads the 402. The buyer picks the `exact` option on `eip155:84532` in its configured USDC, gets a verdict for that amount and `payTo`, then signs that one option with `x402Client` + `ExactEvmScheme` and sends one paid request with `X-Verdict`. What is signed is, by construction, what was approved.
2. **x402's client spend cap is off.** The verdict is the spending control, and it is exact; a $1 cap would only block the $3 review story.
3. **Fail closed on anything before the payment.** That covers an unreachable authorizer (10 s timeout), a non-200 answer, a price above `maxAmount`, no acceptable payment option, and a denied or expired review. Each returns `refused` with nothing signed or sent.
4. **After the payment, report what happened, never "refused" for a payment that went through.** A bad response body still counts as delivered. A request that got no answer is reported with its decision id, because the payment may have settled.
5. **Review is resume, not polling.** `resume(url, decision)` reads the review decision's `superseded_by`. If there is an approval, it re-reads the 402, requires the same price and `payTo`, and pays with the approval's token.
6. **A fresh `Idempotency-Key` per call.** A retry after a timeout is a new purchase decision; the verdict nonce still stops a double delivery.
7. **The MCP server is a thin wrapper around the same buyer.** It has two tools: `pay_and_fetch(url, maxAmount, category)` and `resume_purchase(url, decision)` for the review story. Every outcome, denials included, is an ordinary result for the model to read; only malformed input is a tool error. It runs over stdio (`.mcp.json` at the repo root), so it never logs to stdout.
8. **The tests use the real authorizer and seller**, with a fake facilitator that verifies the EIP-3009 signature against USDC's EIP-712 domain. The money path is proven end to end before any real money moves.

## Consequences

- The agent's tx hash comes from the seller's `PAYMENT-RESPONSE`, and the seller's `deliveries` row is the durable record. The agent keeps no database.
- An approval whose price changed while it waited is refused; the agent must ask again.
- First real call: 27 Oct 2026, $0.01, block 50980908, about 3 seconds end to end (tx `0x5565…56c3`).
