# ADR 0001: A local authorizer instead of Saifuro's API

Status: accepted (draft) · 2026-10-24

## Context

Tollgate demonstrates agent spend authorization end to end. Saifuro's API would be the natural authorizer, but it has no self-registration: sandbox and production keys are issued during customer onboarding, and the TypeScript SDK is private. The project still needs real signed verdicts to exercise the seller-side check.

## Decision

Build a small local authorizer that implements Saifuro's documented decision contract: the mandate shape, the eight decision codes in their documented gate order, ES256-signed verdict tokens with the same claim names, a JWKS endpoint, idempotency keys, and an append-only decision log. Its signing keys use a `local-` `kid` prefix so they can never be mistaken for production or sandbox keys.

The seller's verifier is written against Saifuro's documented procedure and is also tested against Saifuro's real production JWKS using the sample token published in their docs (clock pinned to when it was valid).

## Consequences

- The full loop runs without credentials, on Base Sepolia, with real x402 payments.
- Swapping in Saifuro later means pointing the agent at their base URL and the seller at their JWKS; the verifier already handles their issuer and `kid` conventions.
- The README must state clearly that the authorizer is a stand-in and that no Saifuro API was called.
- Risk: drift if Saifuro changes claims or gate order. Mitigation: the reference doc notes the date the docs were read; re-check before release.
