# ADR 0004: Authorizer API choices

Status: accepted · 2026-10-27

## Context

Day 3 turns the gate function into a service. Saifuro's docs fix the decision object, the token claims and idempotency, but leave open how callers authenticate, how concurrent requests interact, how an agent learns that its review was approved, and what spend counts before any settlement is recorded.

## Decision

1. **Two bearer keys**, after Saifuro's agent and secret keys: `ak_local_…` may only request and read decisions; `sk_local_…` (the console) manages agents, mandates and reviews. Keys are compared in constant time. The deployed demo would otherwise let anyone approve reviews.
2. **One transaction per authorization, under a per-agent advisory lock** (`pg_advisory_xact_lock`). Requests for one agent are evaluated one at a time, so five concurrent $20 requests against a $50 limit allow exactly two. Different agents don't wait for each other. A second lock on the `Idempotency-Key`, always taken first, serialises requests that share a key even across agents. The clock is read after both locks, so a decision's `issued_at` is when it was actually decided.
3. **Idempotency compares the parsed request**, not the raw bytes: `"0.010"` and `"0.01"` are the same request. Same key with a different request is `422 idempotency_key_reused` rather than a silent new evaluation.
4. **Approving a review re-runs the gates with only the review gate passed.** A mandate revoked or a budget spent while the review waited blocks the approval (`409 approval_blocked`) and the review stays pending.
5. **`GET /v1/decisions/:id` with `superseded_by`** lets the agent find the `allow` an approval issued. Saifuro delivers this by webhook; Tollgate has no webhooks yet.
6. **Interim spend rule:** until the seller records settlements (Day 4), the 30-day spend counts every `allow`, used or not. That over-counts unused approvals, which fails safe. _Superseded by ADR 0005 item 7: settled plus still-usable allows._
7. **Every decision is signed**, denials too, so the log holds a verifiable token for each; the seller accepts only `allow`.

## Consequences

- An agent integration needs the agent key; the console needs the secret key, server-side only. The agent key isn't bound to an agent id, so any holder can ask on behalf of any agent; per-agent keys would fix that.
- The lock makes one agent's requests sequential, which is fine at agent speeds and is what makes limits exact.
- Day 4 switched the spend query to settled plus still-usable allows (ADR 0005).
