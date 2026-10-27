// A stand-in authorizer for the seller's tests: its own key, its own key set,
// and verdicts that pass every check unless a test overrides something.

import { newId, VERDICT_ISSUER, VERDICT_TTL_SECONDS } from "@tollgate/shared";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";
export const MANDATE = "mnd_0123456789abcdef0123456789abcdef";
export const NOW = new Date("2026-10-28T12:00:00.000Z");

type Claims = Record<string, unknown>;

export async function createIssuer(kid = "local-test") {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const jwks: { keys: JWK[] } = {
    keys: [{ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }],
  };

  // `request` overrides are merged, so a test can change one field of the deal.
  // An override set to undefined removes that claim.
  async function sign(overrides: Claims = {}, options: { kid?: string } = {}): Promise<string> {
    const iat = Math.floor(NOW.getTime() / 1000);
    const deal = {
      agent: "agt_research_01",
      amount: "0.01",
      currency: "USD",
      recipient: SELLER,
      category: "data",
      ...(overrides.request as Claims | undefined),
    };
    const claims = {
      iss: VERDICT_ISSUER,
      jti: newId("decision"),
      iat,
      exp: iat + VERDICT_TTL_SECONDS,
      verdict: "allow",
      mandate: MANDATE,
      policy_version: "pol_test.1",
      nonce: newId("nonce"),
      ...overrides,
      request: "request" in overrides && overrides.request === undefined ? undefined : deal,
    };
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: options.kid ?? kid })
      .sign(privateKey);
  }

  return { jwks, sign };
}

export function later(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}
