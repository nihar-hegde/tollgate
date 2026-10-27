# services/indexer

Watches the blockchain for USDC transfers to the seller and matches each one to an approval. It answers: **did every payment have a decision, and did every approved payment actually settle?**

Real-world role: the reconciliation clerk. It trusts the chain, not what the agent says it did.

## Why it exists

Authorization can only stop payments made by agents that ask first. An agent (or anyone) can still send USDC to the seller directly without asking. The authorizer can't block that; the indexer **detects** it.

## How it works

1. **Read logs.** Using viem `getLogs`, read `Transfer(from, to, value)` events from the USDC contract where `to` is the seller address.
2. **Cursor.** Start from the block stored in `chain_cursor`. After processing a range, save the new last block. A restart picks up where it stopped, with no gaps and no duplicates.
3. **Confirmations.** Only process blocks a few blocks behind the chain head (small confirmation depth), so a short reorg doesn't record a transfer that later disappears.
4. **Store.** Write each transfer to `settlements` (tx_hash, log_index, from, to, value, block). `(tx_hash, log_index)` is unique, so re-reading a block is harmless.
5. **Reconcile.** Match settlements to the seller's `deliveries` (which link a decision to a tx hash) by transaction hash.

## The two exception lists

| List                        | Meaning                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Allowed, not settled**    | A decision said `allow` and a payment was expected, but no matching transfer appeared on-chain |
| **Paid without a decision** | USDC arrived at the seller with no decision behind it (the agent paid without asking)          |

The console shows both on the Overview screen.

## Payment trace states

For each payment the console shows: **authorized** (decision `allow`) → **verified** (seller accepted the verdict) → **settled** (facilitator returned a tx hash) → **confirmed** (indexer saw the `Transfer` log with enough confirmations).

## Testing it

The plan includes a deliberate test on Day 6: send USDC to the seller directly (no authorization) and confirm it shows up as "paid without a decision".

## Amounts

`value` is stored as an integer in base units ($0.01 = `10000`). No floats.

## Tables it owns

`settlements` and `chain_cursor` (it is the **only** writer of `settlements`). Reads `deliveries` and `decisions`.

## Folder plan

```
src/
  index.ts       polling loop
  watcher.ts     getLogs over block ranges with cursor + confirmations
  reconcile.ts   match settlements to payments, build exception lists
test/
  reconcile.test.ts
```

## Config

`RPC_URL`, `CHAIN_ID`, `USDC_ADDRESS`, `SELLER_ADDRESS`, `DATABASE_URL`. Read-only on-chain; no private key.

## Built on

Day 6. An ADR will cover the choice of confirmation depth.
