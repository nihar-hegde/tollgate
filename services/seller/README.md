# services/seller

The paid API. It charges $0.01 in testnet USDC per call over x402 on Base Sepolia, and it **refuses to take payment** unless the buyer also presents a valid signed approval (a verdict) from the authorizer.

Real-world role: an API company that sells data per request and only accepts buyers whose spending was approved.

## The one route

`GET /v1/insight?topic=…` returns a small piece of data. Price: `10000` USDC base units ($0.01). The content itself doesn't matter; the payment path does.

## How a request is handled

There are two kinds of request, and they are treated very differently.

### 1. Unpaid request (price check)

No payment header. The x402 middleware answers `402 Payment Required` with the price:

- amount: `10000` (base units)
- asset: the USDC contract on Base Sepolia
- network: `eip155:84532`
- `payTo`: the seller's wallet address

**No verdict is checked and no nonce is consumed.** This is how the agent learns the exact price and recipient before asking permission.

### 2. Paid request

Carries an x402 payment header **and** an `X-Verdict` header with the verdict token.

Middleware order:

```
request → verdict check → x402 settle → handler
```

The verdict check runs **before** x402 settles. If the verdict is bad, the request is rejected and the payment is never submitted to the chain, so the buyer loses nothing.

A paid request without `X-Verdict` is rejected.

## The verdict check

Follows Saifuro's seller guide, in this order:

1. **Signature:** verify the JWT against the authorizer's JWKS (ES256 only), check the issuer, require `exp`, `iat`, `nonce`, `verdict`, `request`.
2. **Expiry:** `exp` not passed; `iat` not more than 60 seconds in the future.
3. **Environment:** the `kid` must start with an allowed prefix (`ACCEPTED_KID_PREFIXES`): `local-` in dev, `sandbox-` in tests, neither in a real deployment.
4. **Verdict:** must be exactly `allow`. An `allow` must name a `mandate`.
5. **Claims match this sale exactly:**
   - `request.amount` equals the 402 price (no "close enough")
   - `request.currency` equals `USD` (case-sensitive)
   - `request.recipient` equals this seller's `payTo` address
6. **Operator mandate:** the `mandate` id must be one the paying operator registered with this seller (`OPERATOR_MANDATES`). Without this, any customer of the authorizer could get an `allow` for this seller under their own mandate.
7. **Nonce (last, only after everything else passes):** insert the verdict `nonce` into the `nonces` table. The nonce is the primary key, so a second insert fails. A failed insert means a replay. Because Postgres enforces it, two seller instances can't both accept the same verdict.

On success, the raw verdict token is stored with the delivery record.

Extra hardening from Saifuro's guide: token size limit, reject malformed or padded segments, reject duplicate `kid` in the key set, reject `aud` unless it names this seller, `supersedes` only on `allow`, and refuse a second `allow` that supersedes one already accepted.

## Rejections

Every failure returns `403` with the name of the check that failed:

| Check         | Example cause                                                      |
| ------------- | ------------------------------------------------------------------ |
| `signature`   | Token edited, wrong key, wrong algorithm                           |
| `expiry`      | Token older than 5 minutes                                         |
| `environment` | `kid` prefix not accepted here                                     |
| `nonce`       | Token already used (replay)                                        |
| `claims`      | Wrong amount, currency, recipient, non-`allow`, or unknown mandate |

**Every one of these branches has a test.** This is what reviewers check first.

## Two nonces, never mixed up

- **Verdict nonce** (in the JWT): checked here, stops the same approval being accepted twice.
- **EIP-3009 nonce** (inside the signed USDC payment): enforced on-chain by the USDC contract, stops the same payment being submitted twice.

## Settlement

After the verdict passes, the x402 middleware hands the signed payment to the facilitator (`https://x402.org/facilitator`, free on Base Sepolia). The facilitator submits it to the USDC contract and pays the gas. USDC moves, a `Transfer` event is emitted, and the seller returns the data plus the transaction hash.

## Real-key proof test

One test verifies Saifuro's **published sample token** against Saifuro's **real production JWKS**, with the clock pinned to `2026-09-03T08:45:00Z`. Expected: signature and issuer pass; the full deal check fails at currency (by design, because that token predates `request.currency`). This proves the verifier works against the real thing, not just against Tollgate's own keys. The token is copied from Saifuro's docs at build time, never hand-typed.

## To confirm against the pinned x402 version (2.28.0)

- The payment header's name (it differs between protocol versions).
- That the verdict middleware can run before the x402 middleware settles.

## Tables it owns

`nonces` (nonce PK, exp, delivery_id) and delivery records. Reads the operator mandate list from config.

## Folder plan

```
src/
  index.ts            Express app, middleware order
  verify-verdict.ts   the check above, one function per step
  routes/insight.ts   the paid route
test/
  verify-verdict.test.ts   every rejection branch + unpaid-402 + real JWKS test
```

## Config

`SELLER_PORT`, `SELLER_ADDRESS` (`payTo`), `USDC_ADDRESS`, `CHAIN_ID`, `X402_FACILITATOR_URL`, `AUTHORIZER_URL` (for JWKS), `ACCEPTED_KID_PREFIXES`, `OPERATOR_MANDATES`, `DATABASE_URL`. The seller needs only an address, never a private key.

## Built on

Day 4.
