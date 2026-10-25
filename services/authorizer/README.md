# services/authorizer

The local authorizer: decides whether an agent may spend, signs that decision, and writes it to a log that can never be changed.

It is a **stand-in** for Saifuro's API. Saifuro only issues API keys during customer onboarding, so Tollgate runs its own service that follows Saifuro's documented contract: the same field names, the same eight decision codes, the same gate order and the same verdict token shape. No Saifuro API is ever called. See ADR 0001.

Real-world role: the finance policy desk. It doesn't hold money or move it; it only says yes, no, or "needs a human".

## Who talks to it

| Caller                         | Why                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- |
| Buyer agent (`packages/agent`) | `POST /v1/authorizations` before every payment                             |
| Seller (`services/seller`)     | Fetches the public keys from `/.well-known/jwks.json` to verify verdicts   |
| Console (`apps/console`)       | Creates and revokes mandates, approves and denies reviews, reads decisions |

## Core concepts

**Agent:** an AI buyer with an id like `agt_research_01`, a name, and a status. A disabled agent always gets `deny_no_mandate`.

**Mandate:** an agent's written authority to spend.

```json
{
  "mandate": "mnd_7f3a",
  "principal": "role:research_lead",
  "agent": "agt_research_01",
  "limits": { "per_transaction": 5, "per_month": 50, "currency": "USD" },
  "categories": ["data"],
  "review_above": 2,
  "expires": "2026-12-31",
  "status": "active"
}
```

- **Never edited.** The only change allowed is `status → revoked`. To change limits you revoke and create a new mandate (`replaces` points at the old one). This keeps every old decision explainable by the mandate it was made under.
- Revocation applies from the next request. An `allow` issued before revocation stays valid until it expires (5 minutes).

**Decision:** one spend request evaluated against the mandates in force at that moment. It stores the request, the verdict, the reason, the mandate, the nonce, the mode and the signed token.

**Record:** the decision's line in the `decisions` table. Append-only: a Postgres trigger rejects UPDATE and DELETE. Corrections are new rows.

## The gate order (the heart of this service)

Each request runs through these checks **in this exact order**. The first one that fails decides the result.

| #   | Gate                                                                                         | Fails with        |
| --- | -------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Is there an applicable mandate (agent enabled, mandate in the request's currency)?           | `deny_no_mandate` |
| 2   | Is the mandate revoked?                                                                      | `deny_revoked`    |
| 3   | Is the mandate expired?                                                                      | `deny_expired`    |
| 4   | Is the category in the mandate's `categories`?                                               | `deny_category`   |
| 5   | Is the amount within `per_transaction`, then within the rolling 30-day total vs `per_month`? | `deny_limit`      |
| 6   | Has this agent had 10 or more decisions in the last 60 seconds?                              | `deny_velocity`   |
| 7   | Is the amount above `review_above`?                                                          | `review`          |
| —   | Passed everything                                                                            | `allow`           |

- Velocity is fixed at more than 10 decisions per agent per 60 seconds and is not configurable (matches Saifuro). It protects against runaway agent loops.
- The evaluation is written as a **pure function**: request + mandates + recent history in, verdict + reason out. No database or clock access inside it, so it's easy to test. There is one test per decision code (8 minimum).
- Reasons are human-readable, e.g. `amount 3.00 exceeds review_above 2.00`.

## API

### `POST /v1/authorizations`

Header: `Idempotency-Key: <unique per intended purchase>`

Request:

```json
{
  "agent": "agt_research_01",
  "amount": "0.01",
  "currency": "USD",
  "recipient": "0x…seller payTo address",
  "category": "data",
  "protocol": "x402"
}
```

- `recipient` is the seller's on-chain `payTo` address, so the approval names exactly where the money goes.
- `protocol` is optional and only a label for reports (`x402`, `mpp`, `acp`, `ap2`, `card`). It is not signed.

Response (Saifuro's field names, verbatim):

```json
{
  "decision": "dec_91c4",
  "request": {
    "agent": "…",
    "amount": "0.01",
    "currency": "USD",
    "recipient": "0x…",
    "category": "data"
  },
  "verdict": "allow",
  "reason": "passed all checks",
  "mandate": "mnd_7f3a",
  "nonce": "n_4c81ba97",
  "mode": "enforce",
  "issued_at": "2026-10-29T10:00:00Z",
  "verdict_token": "eyJhbGciOiJFUzI1NiIs…"
}
```

Rules:

- The decision is **written to the log before the response is sent**. If the write fails, there is no answer.
- **Idempotency:** the same key and the same body within 24 hours returns the original decision instead of evaluating again. A 5xx error is never stored, so a retry after a crash is evaluated fresh.
- **Mode** (`observe` or `enforce`) is one environment-wide setting, stamped on every decision. In observe mode the integration pays regardless; in enforce mode it stops unless `allow`.

### Mandates and agents

- Create agent, disable agent, list agents.
- Create mandate, revoke mandate, list mandates per agent (full history). There is deliberately **no edit endpoint**.

### Reviews

- `POST /v1/reviews/:id/approve` issues a **new** `allow` decision whose token carries `supersedes: <original decision id>`.
- `POST /v1/reviews/:id/deny` closes the review.
- Reviews expire after 24 hours.
- Saifuro has no "list reviews" endpoint, so the console builds its queue from decisions with verdict `review`. Tollgate copies that limitation on purpose.

### `GET /.well-known/jwks.json`

The public key set used to verify verdict tokens. Anyone can fetch it.

### `GET /health`

Liveness check for deployment.

## The verdict token

An ES256-signed JWT, made with `jose`.

- Header `kid` starts with `local-` so it can never be mistaken for a Saifuro production or `sandbox-` key.
- Expires 5 minutes after issue (`exp = iat + 300`).
- A fresh random `nonce` per decision. The seller records it so the same approval can't be used twice.
- Signed claims: `iss`, `jti` (the decision id), `iat`, `exp`, `verdict`, `mandate`, `policy_version`, `nonce`, `request`, and `supersedes` on review approvals.
- **Not** in the token: `reason` and `mode` (they're on the decision object only, as in Saifuro's docs).

## Money

Amounts are integers in USDC base units internally (6 decimals: $0.01 = `10000`). The request and token use Saifuro's dollar strings (`"0.01"`, `currency: "USD"`), converted with exact decimal parsing from `packages/shared`. No floats on any money path.

## Tables it owns

`agents`, `mandates`, `decisions`, `reviews`, idempotency keys. Schema lives in `packages/db`.

## Folder plan

```
src/
  index.ts        Express app + startup
  gates.ts        pure gate evaluation (no I/O)
  signing.ts      key pair, JWKS, token issue
  routes/         authorizations, mandates, agents, reviews, jwks
test/
  gates.test.ts   one test per decision code
```

## Config

`DATABASE_URL`, `AUTHORIZER_MODE` (`observe` | `enforce`), port from `AUTHORIZER_URL`. The signing private key stays out of git (`keys/` and `*.pem` are ignored).

## Built on

Day 2 (gates, schema, 8 tests) and Day 3 (signing, JWKS, API, reviews).
