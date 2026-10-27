// The verifier against the real thing: Saifuro's production key and their
// published sample verdict, with the clock pinned to when it was alive.

import { toBaseUnits } from "@tollgate/shared";
import { createLocalJWKSet, createRemoteJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { checkVerdict, type Sale, type VerdictPolicy } from "../src/verdict";
import {
  SAIFURO_ISSUER,
  SAIFURO_JWKS,
  SAIFURO_JWKS_URL,
  SAIFURO_SAMPLE_VERDICT,
} from "./fixtures/saifuro";

const WHILE_ALIVE = new Date("2026-09-03T08:45:00Z");

// The deal the sample token approves, as a seller would describe it.
const SALE: Sale = { amount: toBaseUnits("340"), currency: "USD", recipient: "vendor:acme_saas" };

const policy: VerdictPolicy = {
  keys: createLocalJWKSet(SAIFURO_JWKS),
  issuer: SAIFURO_ISSUER,
  audience: "https://seller.example",
  kidPrefixes: ["verdict-"],
  operatorMandates: new Set(["mnd_7f3a"]),
};

describe("Saifuro's sample verdict", () => {
  it("passes signature, issuer, expiry, environment, verdict and amount, then fails at currency", async () => {
    // The token predates request.currency, so Saifuro's docs say this is where it must fail.
    expect(await checkVerdict(SAIFURO_SAMPLE_VERDICT, SALE, policy, WHILE_ALIVE)).toEqual({
      ok: false,
      check: "claims",
      reason: "currency (missing) is not USD",
    });
  });

  it("is expired today", async () => {
    const result = await checkVerdict(SAIFURO_SAMPLE_VERDICT, SALE, policy, new Date());
    expect(!result.ok && result.check).toBe("expiry");
  });

  it("is refused by a seller that only accepts Tollgate's local keys", async () => {
    const local = { ...policy, kidPrefixes: ["local-"] };
    const result = await checkVerdict(SAIFURO_SAMPLE_VERDICT, SALE, local, WHILE_ALIVE);
    expect(!result.ok && result.check).toBe("environment");
  });
});

// Network test, run in CI: the live key set still matches the copy and still verifies the token.
describe.runIf(process.env.SAIFURO_LIVE === "1")("Saifuro's live key set", () => {
  it("matches the copy in the fixtures", async () => {
    const live: unknown = await (await fetch(SAIFURO_JWKS_URL)).json();
    expect(live).toEqual(SAIFURO_JWKS);
  });

  it("verifies the sample verdict the same way", async () => {
    const remote = { ...policy, keys: createRemoteJWKSet(new URL(SAIFURO_JWKS_URL)) };
    const result = await checkVerdict(SAIFURO_SAMPLE_VERDICT, SALE, remote, WHILE_ALIVE);
    expect(!result.ok && result.reason).toBe("currency (missing) is not USD");
  });
});
