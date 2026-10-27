# ADR 0005: Seller verdict check and delivery records

Status: accepted · 2026-10-27

## Context

The seller must refuse to take payment unless the buyer presents a valid verdict, following Saifuro's seller guide. Saifuro leaves open where the check sits relative to x402, where the nonce is stored, how a seller records what it delivered, and how the authorizer learns which approvals were actually spent (ADR 0002 rule 3, deferred by ADR 0004).

## Decision

1. **The whole verdict check runs before x402, and only on requests that carry a payment.** It uses the same test as x402 (`PAYMENT-SIGNATURE` or `X-PAYMENT` present), so the two can't disagree about what counts as paid. An unpaid price check is never verdict-checked, and a bad verdict never reaches the facilitator.
2. **The check is two steps.** `checkVerdict` is stateless and covers signature, issuer, ES256, expiry, a future `iat`, `kid` prefix, verdict, mandate present, `aud`, exact amount/currency/recipient and the operator's mandates. `claimDelivery` then inserts the delivery row. That insert is the nonce record.
3. **One `deliveries` table instead of `nonces` plus `payments`.** The unique `verdict_nonce` is the replay check, a unique `supersedes_id` refuses a second approval of the same review, and the row keeps the raw token. Its status moves once from `pending` to `settled` (with `tx_hash` and `payer`) or `failed` (with the reason). A trigger enforces this, as for reviews. There are no foreign keys to `decisions`, because a seller only knows what the token says.
4. **Amounts are compared as exact decimals in base units.** `"0.010"` matches a $0.01 price; a number (as Saifuro signs it) is parsed the same way. Currency and recipient must match exactly and case-sensitively, so the agent must copy `payTo` from the 402 unchanged.
5. **A verdict is consumed when the seller accepts it, not when money moves.** If the facilitator then rejects the payment, the delivery is `failed` and the buyer must authorize again. That fails safe: nothing settles without a recorded nonce.
6. **The outcome is recorded right after x402 answers**, from its `PAYMENT-RESPONSE` header (or `PAYMENT-REQUIRED` on a rejected payment). The row that matters for safety, the pending delivery with its nonce, already exists before any money moves.
7. **The authorizer's 30-day spend is now "settled plus still usable"** (ADR 0002 rule 3, replacing ADR 0004 item 6). An `allow` counts while its token can still be spent (5 minutes plus a minute of skew), and for the full 30 days once a seller holds a non-failed delivery for it.
8. **Switching to Saifuro is configuration:** `VERDICT_ISSUER`, `VERDICT_JWKS_URL` and `ACCEPTED_KID_PREFIXES`. A test checks the verifier against Saifuro's production key set and published sample token.
9. **A $3 report route** sits next to the $0.01 insight, so the review user story has something to buy above the $2 threshold.

## Consequences

- The verdict check is one middleware and one insert. Replay safety across seller instances comes from Postgres, not memory.
- A buyer whose payment fails must request a new verdict.
- In Tollgate the authorizer reads the seller's `deliveries` table because they share one database. A real authorizer would learn settlements from the buyer's own records or the chain; the indexer (Day 6) moves this toward on-chain confirmation.
- Operator mandates are an env list (`OPERATOR_MANDATES`), so replacing a mandate also means updating the seller. A real seller would keep them in its customer records.
