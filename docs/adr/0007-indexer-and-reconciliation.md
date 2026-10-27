# ADR 0007: Indexer and reconciliation

Status: accepted · 2026-10-27

## Context

The seller's `deliveries` say what it accepted and what the facilitator reported, but the chain is the only record that can't be wrong. The indexer must read USDC transfers to the seller safely across restarts and short reorgs. It must match each transfer to a delivery and surface two exceptions: allowed but not settled, and paid without a decision. A seller crash between accepting a verdict and recording the outcome leaves a delivery `pending` with no tx hash (ADR 0005).

## Decision

1. **Read `Transfer(to = seller)` logs over at most 200 blocks per request** (the public Base Sepolia RPC refuses more). Only read blocks with **5 confirmations** (about 10 seconds on Base), so a short reorg can't record a transfer that later disappears.
2. **Each range is one transaction**: the settlements and the cursor (`chain_cursors`) move together. A crash or RPC error re-reads that range; `(tx_hash, log_index)` is the primary key, so re-reading stores nothing twice.
3. **Each settlement keeps its EIP-3009 nonce**, taken from the `AuthorizationUsed` event in the same receipt (one receipt fetch per transfer; null for a direct transfer). The seller now records the payer and that nonce from the payment header when it accepts a verdict. This is the second nonce of "two nonces, never mixed up", put to work.
4. **Matching uses the tx hash, or else payer plus EIP-3009 nonce.** The second key lets the indexer complete a delivery stuck at `pending` as `settled`, but only for the same amount. Both the seller and the indexer complete a delivery only from `pending`, so whichever is first wins and the other is a no-op.
5. **Reconciliation is computed, not stored.** `reconcile(db, seller, now)` returns four lists:
   - `confirmed`;
   - `unconfirmed`: a pending or settled delivery with no transfer after a 10-minute grace;
   - `unexpected`: a transfer with no delivery, meaning paid without a decision;
   - `mismatched`: a transfer that disagrees on amount, status or tx hash.

   It is exported for the console and printed by `pnpm --filter @tollgate/indexer report`.

6. **Settlements are append-only** (a trigger, as for decisions). The indexer is their only writer.

## Consequences

- A deeper reorg than 5 blocks isn't handled. For a testnet demo that is acceptable; production would track block hashes and roll back.
- Reconciliation loads one seller's rows into memory, which is fine at demo volume. At scale it would be SQL joins over a time window, with stored exception states for alerting.
- The first live run (27 Oct 2026) confirmed the Day 5 payment, and flagged a direct $0.01 transfer (block 50989909) as paid without a decision.
