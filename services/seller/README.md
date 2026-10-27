# services/seller

The paid API. It charges testnet USDC per call over x402 on Base Sepolia, and it **refuses to take payment** unless the buyer also presents a valid signed approval (a verdict) from the authorizer.

Real-world role: an API company that sells data per request and only accepts buyers whose spending was approved.

## Routes

| Route                   | Price                     | Why                                                       |
| ----------------------- | ------------------------- | --------------------------------------------------------- |
| `GET /v1/insight?topic` | `10000` base units, $0.01 | The everyday paid call                                    |
| `GET /v1/report?topic`  | `3000000`, $3             | Above the mandate's $2 review threshold: the review story |
| `GET /health`           | free                      | Health check                                              |

The content is sample data; the payment path is what matters. Prices are exact base-unit amounts in `PRODUCTS` (`src/app.ts`). The same number feeds both the x402 402 response and the verdict's amount check, so they can't drift apart.

## How a request is handled

```
request ─► requireVerdict ─► x402 (verify ─► handler ─► settle) ─► record outcome
```

### 1. Unpaid request (price check)

No payment header. `requireVerdict` steps aside and x402 answers `402 Payment Required`. The `PAYMENT-REQUIRED` header (base64 JSON) carries `scheme: exact`, `network: eip155:84532`, `amount: "10000"`, the USDC `asset`, `payTo` (the seller's address) and USDC's EIP-712 domain (`name: USDC`, `version: 2`).

**No verdict is checked and no nonce is consumed**, even if an `X-Verdict` header is sent along. This is how the agent learns the exact price and recipient before asking permission.

### 2. Paid request

It carries an x402 payment header (`PAYMENT-SIGNATURE`, or v1's `X-PAYMENT`) **and** `X-Verdict: <verdict token>`. `requireVerdict` decides "paid" with the same test x402 uses, so the two can never disagree.

1. **Verdict check** (`src/verdict.ts`), stateless. Any failure → `403`, and the facilitator is never called.
2. **Nonce** (`src/deliveries.ts`): insert a `pending` delivery row. Its `verdict_nonce` is unique, so a second insert of the same verdict fails → `403 nonce`. Postgres enforces it, so two seller instances can't both accept one verdict. The row also keeps the payer and the EIP-3009 nonce read from the payment header, so the indexer can find the transfer on-chain even if this process dies before step 4 (ADR 0007).
3. **x402** asks the facilitator to verify the payment (no money moves), runs the handler with its response held back, then settles. Settlement only happens if the handler succeeded.
4. **Record**: once x402 has answered, the delivery becomes `settled` (with `tx_hash`, read from `PAYMENT-RESPONSE`) or `failed` (with the facilitator's reason). Only a `pending` delivery is updated, since the indexer may have settled it from the chain first.

A verdict is used up once step 2 passes. If the payment then fails, the delivery is `failed`, nothing settles, and the buyer authorizes again. ADR 0005.

## The verdict check

This follows Saifuro's seller guide (https://docs.saifuro.com/reference/verify-a-verdict), in this order:

1. **Shape**: present, at most 4096 characters, three base64url segments with no padding or whitespace (jose would accept both).
2. **Signature**: jose `jwtVerify` against the key set: ES256 only, the trusted issuer, and `exp`, `iat`, `nonce`, `verdict` and `request` required. A `kid` listed twice in the set is refused.
3. **Expiry**: `exp` not passed; `iat` no more than 60 seconds in the future (jose doesn't check this by itself).
4. **Environment**: the `kid` starts with an accepted prefix (`ACCEPTED_KID_PREFIXES`): `local-` here, `sandbox-` only for a sandbox consumer, a production prefix for real deliveries.
5. **Verdict**: exactly `allow`, and an `allow` must name a `mandate`. An `aud` claim, if present, must name this seller.
6. **The deal, exactly**: `request.amount` equals the price, compared as exact decimals in base units (`"0.010"` matches; `340` as Saifuro signs it parses the same way); `request.currency` is `USD`, case-sensitive; `request.recipient` is this seller's `payTo`, case-sensitive.
7. **Operator mandate**: the `mandate` is one the paying operator registered with this seller (`OPERATOR_MANDATES`). Otherwise any customer of the authorizer could get an `allow` for this seller under its own mandate.
8. **Nonce, last**: the delivery insert above. A second `allow` superseding the same review is refused the same way (unique `supersedes_id`).

## Rejections

Every refusal is `403` with the failed check:

```json
{
  "error": {
    "code": "verdict_rejected",
    "check": "nonce",
    "message": "verdict nonce n_… was already used"
  }
}
```

| Check         | Example cause                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `signature`   | No `X-Verdict`, edited token, wrong key, `alg` not ES256, wrong issuer, padded token                                 |
| `expiry`      | Token older than 5 minutes, or issued in the future                                                                  |
| `environment` | `kid` prefix not accepted here (e.g. a `sandbox-` key)                                                               |
| `nonce`       | Verdict already used, or the review was already paid for with another approval                                       |
| `claims`      | Not `allow`, no mandate, missing claim, wrong amount, currency or recipient, unknown mandate, `aud` for someone else |

A failed payment after the verdict passed is x402's `402`, not a `403`.

## Two nonces, never mixed up

- **Verdict nonce** (in the JWT, stored as `deliveries.verdict_nonce`): checked here, stops the same approval being accepted twice.
- **EIP-3009 nonce** (inside the buyer's signed USDC authorization, stored as `deliveries.authorization_nonce`): enforced on-chain by the USDC contract, stops the same payment being submitted twice. The contract logs it, which is how the indexer ties a transfer back to its delivery.

## Settlement

The facilitator (`https://x402.org/facilitator`, free on Base Sepolia) submits the buyer's signed authorization to the USDC contract and pays the gas. The seller needs only an address, never a private key. On success the response carries `PAYMENT-RESPONSE` with the transaction hash, and the delivery row keeps it for the console and the indexer.

## Real-key proof test

`test/saifuro.test.ts` checks the verifier against **Saifuro's production key set**, using their **published sample token**, with the clock pinned to `2026-09-03T08:45:00Z`. It passes signature, issuer, expiry, environment, verdict and amount, then fails at currency, which is what their docs say must happen because the token predates `request.currency`. Both are copied in `test/fixtures/saifuro.ts`, not hand-typed. With `SAIFURO_LIVE=1` (set in CI) it also fetches the live key set and checks it still matches.

Verifying real Saifuro verdicts is configuration only: set `VERDICT_ISSUER`, `VERDICT_JWKS_URL` and `ACCEPTED_KID_PREFIXES`.

## Running it

```sh
pnpm db:up && pnpm db:migrate
pnpm --filter @tollgate/authorizer seed     # prints the demo mandate id for OPERATOR_MANDATES
pnpm --filter @tollgate/authorizer dev      # :4000, serves the key set
pnpm --filter @tollgate/seller dev          # :4001
curl -i localhost:4001/v1/insight           # 402 with the price
```

## Config

| Variable                | Default                                 | What                                          |
| ----------------------- | --------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`          | required                                | Postgres                                      |
| `SELLER_URL`            | `http://localhost:4001`                 | Port, and the name an `aud` claim must use    |
| `SELLER_ADDRESS`        | required                                | `payTo`, and the recipient verdicts must name |
| `USDC_ADDRESS`          | required                                | USDC on Base Sepolia                          |
| `X402_FACILITATOR_URL`  | `https://x402.org/facilitator`          | Verifies and settles payments                 |
| `AUTHORIZER_URL`        | `http://localhost:4000`                 | Where the key set lives, unless overridden    |
| `VERDICT_ISSUER`        | `tollgate-local-authorizer`             | Trusted `iss`                                 |
| `VERDICT_JWKS_URL`      | `$AUTHORIZER_URL/.well-known/jwks.json` | Key set, cached 5 minutes                     |
| `ACCEPTED_KID_PREFIXES` | `local-`                                | Comma-separated                               |
| `OPERATOR_MANDATES`     | required                                | Comma-separated mandate ids                   |

## Folder plan

```
src/
  index.ts        entrypoint: config, key set, facilitator, listen
  app.ts          routes and prices, requireVerdict, recording the outcome
  verdict.ts      checkVerdict(): every stateless check above
  deliveries.ts   claimDelivery() (the nonce) and completeDelivery()
  payment.ts      the x402 paywall, carriesPayment(), settlementOf()
  config.ts       env, validated with Zod
test/
  purchase.test.ts   HTTP tests with a fake facilitator: 402, every refusal, replay, concurrency, failed payments
  saifuro.test.ts    the real-key proof test
  issuer.ts          a test authorizer that signs verdicts
  harness.ts         the app on a random port against tollgate_seller_test
  fixtures/          Saifuro's sample token and key set
src/verdict.test.ts  every branch of checkVerdict()
```

## Built on

Day 4.
