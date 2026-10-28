# services/indexer

Watches the blockchain for USDC transfers to the seller and matches each one to an approval. It answers: **did every payment have a decision, and did every approved payment actually settle?**

Real-world role: the reconciliation clerk. It trusts the chain, not what the agent or the seller says happened.

## Why it exists

Authorization can only stop payments made by agents that ask first. An agent (or anyone) can still send USDC to the seller directly without asking. The authorizer can't block that; the indexer **detects** it.

## How it works

1. **Read logs** (`src/chain.ts`). viem `getLogs` reads `Transfer(from, to, value)` events from the USDC contract where `to` is the seller, at most 200 blocks per request (the public RPC refuses more). For each transfer it reads the receipt and takes the EIP-3009 nonce from the `AuthorizationUsed` event. A direct transfer has none.
2. **Confirmations.** It only reads blocks with 5 blocks on top (about 10 seconds on Base), so a short reorg can't record a transfer that later disappears.
3. **Store and move the cursor together** (`src/indexer.ts`). Each range is one transaction: write the transfers to `settlements` and move `chain_cursors.last_block`. A crash or RPC error just re-reads that range. `(tx_hash, log_index)` is unique, so reading a block twice stores nothing twice.
4. **Finish stuck deliveries.** If the seller accepted a verdict but never recorded the outcome (say it crashed), the delivery is still `pending` with no tx hash. A transfer from the same payer with the same EIP-3009 nonce and amount settles it.
5. **Reconcile** (`src/reconcile.ts`). Match each settlement to a delivery by tx hash, or else by payer + EIP-3009 nonce, and sort everything into four lists.

## The lists

| List          | Meaning                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `confirmed`   | The seller says settled and the chain agrees                                                                                   |
| `unconfirmed` | **Allowed, not settled:** the seller accepted a verdict, but no transfer reached the chain within 10 minutes                   |
| `unexpected`  | **Paid without a decision:** USDC arrived with no accepted verdict behind it                                                   |
| `mismatched`  | On-chain, but disagreeing with the seller's record: a different amount, recorded `failed` or `pending`, or a different tx hash |

A delivery the seller recorded as `failed` with no transfer is expected and appears in no list.

```sh
pnpm --filter @tollgate/indexer report
```

This prints the lists with Basescan links. The console imports `reconcile()` from `@tollgate/indexer/reconcile`.

## Payment trace states

For each payment the console shows **authorized** (decision `allow`) → **verified** (seller accepted the verdict: a delivery exists) → **settled** (facilitator returned a tx hash) → **confirmed** (the indexer saw the `Transfer` with enough confirmations).

## First live run (27 Oct 2026)

- The Day 5 payment (block 50980908) came out `confirmed` against its decision.
- A direct $0.01 transfer from the agent wallet, with no verdict and no x402, landed in `unexpected`: https://sepolia.basescan.org/tx/0x021eae43ec80d66338d42ab7b5a1e8ff63cfbda1889d1b45e8341070cecb6e44
- A new x402 purchase (block 50990023) was confirmed. The EIP-3009 nonce the seller read from the payment header equals the one the USDC contract logged.

## Tests

`test/indexer.test.ts` and `test/reconcile.test.ts` run against a fake chain and `tollgate_indexer_test`. They cover:

- the confirmation boundary;
- reading in ranges of at most 200 blocks with no gaps;
- restarting from the cursor;
- re-reading with nothing stored twice;
- an RPC failure keeping earlier ranges and resuming;
- finishing a stuck delivery (and not finishing it for another amount);
- every list.

Settlements can't be deleted, so each test uses its own seller address and cursor.

## Amounts

`value` is stored as an integer in base units ($0.01 = `10000`). No floats.

## Tables it owns

`settlements` (it is the **only** writer; append-only) and `chain_cursors`. It reads `deliveries`, and completes only the `pending` ones the chain proves were paid.

## Running it

```sh
INDEXER_START_BLOCK=50980900 pnpm --filter @tollgate/indexer dev   # first run; after that the cursor decides
curl localhost:4002/health                                          # the saved cursor (so a catch-up shows progress), or the last RPC error (503)
```

## Folder plan

```
src/
  index.ts       polling loop and /health
  chain.ts       the Chain interface and its Base Sepolia (viem) implementation
  indexer.ts     catchUp(): ranges, confirmations, cursor, finishing stuck deliveries
  reconcile.ts   the four lists
  report.ts      prints them
  config.ts      env, validated with Zod (Base Sepolia only)
test/
  fakes.ts             a fake chain and row builders
  indexer.test.ts
  reconcile.test.ts
```

## Config

| Variable                | Default                 |                                   |
| ----------------------- | ----------------------- | --------------------------------- |
| `DATABASE_URL`          |                         | required                          |
| `CHAIN_ID`              |                         | must be `84532`                   |
| `RPC_URL`               |                         | Base Sepolia RPC                  |
| `USDC_ADDRESS`          |                         |                                   |
| `SELLER_ADDRESS`        |                         | whose incoming transfers to watch |
| `INDEXER_URL`           | `http://localhost:4002` | port for `/health`                |
| `INDEXER_START_BLOCK`   | the current head        | only used before a cursor exists  |
| `INDEXER_CONFIRMATIONS` | `5`                     |                                   |
| `INDEXER_BLOCK_RANGE`   | `200`                   | at most 200                       |
| `INDEXER_POLL_MS`       | `5000`                  |                                   |

Read-only on-chain; no private key. Choices: [ADR 0007](../../docs/adr/0007-indexer-and-reconciliation.md).

## Built on

Day 6.
