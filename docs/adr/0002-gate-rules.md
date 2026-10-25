# ADR 0002: How the authorizer's gates read ambiguous rules

Status: accepted · 2026-10-25

## Context

The authorizer follows Saifuro's documented gate order and decision codes (ADR 0001). The docs leave several details open: which mandate applies when an agent has had more than one, when a date-only expiry ends, what counts toward the rolling 30-day limit and the velocity limit, and how strictly categories and amounts are matched. These choices decide every gate test, so they are written down once here.

## Decision

1. **One active mandate per agent per currency.** The database enforces it with a unique index on active mandates. Replacing a mandate revokes the old one and creates the new one in a single transaction. The gate uses the active mandate; if there is none and the latest one was revoked, the answer is `deny_revoked`; if the agent never had one in that currency, `deny_no_mandate`.
2. **`expires` is a date, valid through the end of that day in UTC.** A mandate with `expires: "2026-12-31"` allows requests until 23:59:59.999 UTC on 31 Dec and returns `deny_expired` from 00:00 UTC on 1 Jan.
3. **The rolling 30-day spend counts money that can actually move:** settled payments in the last 30 days plus `allow` approvals that are still usable (issued under 5 minutes ago) and not yet settled. Expired, unused approvals drop out. Counting live approvals stops an agent from overspending by asking several times before any payment settles.
4. **Velocity counts every authorization decision** for the agent in the last 60 seconds, denials included; the 11th gets `deny_velocity`. Free 402 price checks go to the seller, never to the authorizer, so they never count. Counting denials is what catches a runaway loop that keeps being denied, and matches Saifuro's "10 decisions per 60 seconds".
5. **An unknown agent id gets `deny_no_mandate`** and is logged like any other decision, so the console can show attempts to spend as an agent that doesn't exist. A malformed request body is a `400` and is not a decision.
6. **Categories are lowercase** (`a-z`, `0-9`, `_`), both in mandates and in requests, and are matched exactly. Uppercase input is rejected as invalid rather than silently converted.
7. **Amounts are strings on the wire** (`"0.01"`), never JSON numbers, and are converted to integer USDC base units with exact parsing. Saifuro's examples use JSON numbers; Tollgate is stricter so no amount ever passes through a float.

## Consequences

- Every rule above has a test in `services/authorizer` or `packages/shared`.
- Rules 1 and 3 need data from other tables (mandate history; settlements and live approvals), which the service gathers before calling the pure gate function.
- An agent integration built for Saifuro that sends numeric amounts must send strings to Tollgate. The README's integration guide says so.
- If Saifuro documents any of these differently later, this ADR is the list to re-check.
