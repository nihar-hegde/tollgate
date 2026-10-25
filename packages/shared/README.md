# packages/shared

Code every other module imports, so that types and rules are defined once. It has no I/O: no database, no network, no environment variables. That keeps it safe to import from the console's browser code as well as from the services.

## What goes here

### Types and Zod schemas

The shapes that cross service boundaries, using **Saifuro's field names verbatim**:

- Authorization request: `agent`, `amount`, `currency`, `recipient`, `category`, `protocol?`
- Decision object: `decision`, `request`, `verdict`, `reason`, `mandate`, `nonce`, `mode`, `issued_at`, `verdict_token`
- Verdict token claims: `iss`, `jti`, `iat`, `exp`, `verdict`, `mandate`, `policy_version`, `nonce`, `request`, `supersedes?`
- Mandate: `mandate`, `principal`, `agent`, `limits { per_transaction, per_month, currency }`, `categories`, `review_above`, `expires`, `status`, `replaces?`

Each has a Zod schema (for validating input at the edges) and an inferred TypeScript type.

### Decision codes

The eight codes as a single constant, in gate order:

`allow`, `review`, `deny_limit`, `deny_velocity`, `deny_category`, `deny_expired`, `deny_revoked`, `deny_no_mandate`

Also the seller's rejection check names: `signature`, `expiry`, `environment`, `nonce`, `claims`.

### Amount helpers

The most important code in this package. All money is held as integers in USDC base units (6 decimals) and never as floats.

| Dollars  | Base units |
| -------- | ---------- |
| `"0.01"` | `10000`    |
| `"2.00"` | `2000000`  |
| `"5"`    | `5000000`  |

- `toBaseUnits("0.01") → 10000n`: exact decimal parsing of a string. Rejects more than 6 decimal places, negatives and malformed input.
- `fromBaseUnits(10000n) → "0.01"`: for verdict claims and display.
- Comparisons on `bigint`, so large amounts compare exactly (Saifuro's guide says to compare amounts above 1e9 as decimals, not floats).

These get thorough tests, including edge cases like `"0.1"` vs `"0.10"`, `"1e-2"` (rejected) and the 6-decimal limit.

### ID helpers

Prefixes used across the system: `agt_`, `mnd_`, `dec_`, `n_` (verdict nonce).

### Chain constants

Base Sepolia chain id `84532`, CAIP-2 id `eip155:84532`, USDC decimals `6`.

## What does **not** go here

- Database code (that's `packages/db`).
- Anything that reads `.env` or makes network calls.

## Folder plan

```
src/
  index.ts      re-exports
  schemas.ts    Zod schemas + types
  codes.ts      decision codes, rejection names
  amounts.ts    base-unit conversion
  ids.ts        id prefixes
test/
  amounts.test.ts
```

## Built on

Day 2 onwards, as each service needs a shared type.
