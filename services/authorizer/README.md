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

## Running it

```sh
pnpm db:up && pnpm db:migrate
pnpm --filter @tollgate/authorizer keygen   # adds the signing key and API keys to .env (values never printed)
pnpm --filter @tollgate/authorizer seed     # agt_research_01 with the user-story mandate
pnpm --filter @tollgate/authorizer dev      # http://localhost:4000
```

## API keys

Two bearer keys, after Saifuro's agent and secret keys ([ADR 0004](../../docs/adr/0004-authorizer-api.md)):

| Key                                    | Used by     | Can call                                           |
| -------------------------------------- | ----------- | -------------------------------------------------- |
| `ak_local_…` (`AUTHORIZER_AGENT_KEY`)  | buyer agent | `POST /v1/authorizations`, `GET /v1/decisions/:id` |
| `sk_local_…` (`AUTHORIZER_SECRET_KEY`) | console     | agents, mandates, reviews, `GET /v1/decisions/:id` |

`/health` and `/.well-known/jwks.json` are public. Errors are `{ "error": { "code", "message" } }`.

## API

### `POST /v1/authorizations` (agent key)

Header: `Idempotency-Key: <unique per intended purchase>` (1–255 characters, required).

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

- `amount` is a dollar string; a JSON number is a `400` (ADR 0002 rule 7).
- `recipient` is the seller's on-chain `payTo` address, so the approval names exactly where the money goes.
- `protocol` is optional, a label for reports only, and not signed.

Response, with Saifuro's field names:

```json
{
  "decision": "dec_…",
  "request": {
    "agent": "…",
    "amount": "0.01",
    "currency": "USD",
    "recipient": "0x…",
    "category": "data",
    "protocol": "x402"
  },
  "verdict": "allow",
  "reason": "passed all checks",
  "mandate": "mnd_…",
  "policy_version": "pol_local.1",
  "nonce": "n_…",
  "mode": "enforce",
  "issued_at": "2026-10-27T12:00:00.000Z",
  "verdict_token": "eyJhbGciOiJFUzI1NiIs…",
  "supersedes": null,
  "superseded_by": null,
  "review": null
}
```

- **One transaction per request**: lock the agent, check the idempotency key, gather the facts, run the gates, sign, write the decision (and a review if the verdict is `review`). The decision is in the log before the response leaves. Any failure stores nothing.
- **Per-agent lock**: concurrent requests for one agent are evaluated one at a time, so they can't all fit under the same limit.
- **Idempotency**: same key and same request within 24 hours returns the original decision with `Idempotent-Replayed: true`. The request is compared by value (`"0.010"` equals `"0.01"`). Same key with a different request is a `422`. A key older than 24 hours is evaluated afresh.
- **30-day spend** is settled plus still usable (ADR 0005): an `allow` counts while its token can be spent (5 minutes plus a minute of clock skew), and for the full 30 days once a seller has accepted it, unless that payment failed. An approval nobody used frees its budget after 6 minutes.
- **Mode** (`observe` | `enforce`) comes from `AUTHORIZER_MODE` and is stamped on every decision.

### `GET /v1/decisions/:id` (either key)

The decision as above. For a `review` decision, `review` holds `{ review, status, expires_at, resolved_at }` (`status` is `pending`, `approved`, `denied` or `expired`), and `superseded_by` names the `allow` an approval issued. This is how the agent finds its approval. Not in Saifuro's API; added in ADR 0004.

### Agents (secret key)

- `POST /v1/agents` `{ id, name }` → `201`; `409` if the id is taken.
- `GET /v1/agents`
- `POST /v1/agents/:id/disable`

### Mandates (secret key)

- `POST /v1/mandates` (Saifuro's mandate shape, dollar strings) → `201`; `409` if the agent already has an active mandate in that currency.
- `POST /v1/mandates/:id/replace` (a full new mandate for the same agent and currency): revokes the old one and creates the successor, with `replaces`, in one transaction.
- `POST /v1/mandates/:id/revoke` → `409` if already revoked.
- `GET /v1/mandates?agent=agt_…`: full history, oldest first.
- There is deliberately **no edit endpoint**.

### Reviews (secret key)

- `POST /v1/reviews/:id/approve` runs the gates again with the review gate passed. If they allow, it issues a **new** `allow` whose token carries `supersedes`; if not (mandate revoked, expired, budget spent meanwhile) it's a `409 approval_blocked` and the review stays pending.
- `POST /v1/reviews/:id/deny` closes it.
- Both are `409` once the review is resolved or 24 hours old.
- Like Saifuro, there is no "list reviews" endpoint; the console builds its queue from decisions.

## The verdict token

An ES256 JWT signed with `jose`.

- `kid` is `local-` plus the key's thumbprint, so it can never be mistaken for a Saifuro production or `sandbox-` key. `iss` is `tollgate-local-authorizer`.
- `exp = iat + 300`; `issued_at` is kept to whole seconds so it equals `iat`.
- Claims: `iss`, `jti` (the decision id), `iat`, `exp`, `verdict`, `mandate`, `policy_version`, `nonce`, `request` (without `protocol`), and `supersedes` on approvals. Not `reason` or `mode`.
- Every decision is signed, denials too; the seller accepts only `allow`.

## Money

Integers in USDC base units internally ($0.01 = `10000`), dollar strings on the wire and in the token, converted exactly by `packages/shared`.

## Folder plan

```
src/
  index.ts       startup: config, db, signer, listen
  config.ts      environment, validated with Zod
  app.ts         routes
  http.ts        API-key check, body parsing, error responses
  context.ts     what the services need (db, clock, signer, mode)
  decisions.ts   the authorize transaction, signing a decision, reading one back
  facts.ts       per-agent lock; agent, mandates, spend and velocity from the db
  gates.ts       the pure gate function
  reviews.ts     approve and deny
  mandates.ts    create, replace, revoke, list
  agents.ts      create, list, disable
  mapping.ts     db rows → gate types and API JSON
  signing.ts     ES256 key, JWKS, token signing
scripts/
  keygen.ts      adds keys to .env
  seed.ts        user-story agent and mandate
test/            HTTP tests against tollgate_authorizer_test (harness.ts starts the app)
```

How each gate reads the rules is in [ADR 0002](../../docs/adr/0002-gate-rules.md); API choices are in [ADR 0004](../../docs/adr/0004-authorizer-api.md).

## Config

| Variable                                        | Default                 |                                    |
| ----------------------------------------------- | ----------------------- | ---------------------------------- |
| `DATABASE_URL`                                  |                         | required                           |
| `AUTHORIZER_URL`                                | `http://localhost:4000` | the port is taken from it          |
| `AUTHORIZER_MODE`                               | `enforce`               | `observe` or `enforce`             |
| `AUTHORIZER_POLICY_VERSION`                     | `pol_local.1`           | stamped on decisions and tokens    |
| `AUTHORIZER_SIGNING_KEY`                        |                         | private JWK as JSON, from `keygen` |
| `AUTHORIZER_AGENT_KEY`, `AUTHORIZER_SECRET_KEY` |                         | from `keygen`                      |

## Built on

Day 2 (gates, schema) and Day 3 (signing, API, idempotency, reviews).
