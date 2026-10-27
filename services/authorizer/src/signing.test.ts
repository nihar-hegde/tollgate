import { VERDICT_ISSUER, type VerdictClaims } from "@tollgate/shared";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createSigner, generateSigningKey } from "./signing";

const claims: VerdictClaims = {
  iss: VERDICT_ISSUER,
  jti: "dec_00000000000000000000000000000001",
  iat: 1_793_102_400,
  exp: 1_793_102_700,
  verdict: "allow",
  mandate: "mnd_00000000000000000000000000000001",
  policy_version: "pol_local.1",
  nonce: "n_00000000000000000000000000000001",
  request: {
    agent: "agt_research_01",
    amount: "0.01",
    currency: "USD",
    recipient: "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0",
    category: "data",
  },
};

const verifyAt = (iat: number) => ({ currentDate: new Date(iat * 1000) });

describe("verdict signing", () => {
  it("signs a token that verifies against the published key set", async () => {
    const signer = await createSigner(await generateSigningKey());
    const token = await signer.sign(claims);

    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet(signer.jwks),
      verifyAt(claims.iat),
    );
    expect(payload).toEqual(claims);
  });

  it("uses ES256 and a local- key id", async () => {
    const signer = await createSigner(await generateSigningKey());
    const header = decodeProtectedHeader(await signer.sign(claims));

    expect(header).toEqual({ alg: "ES256", typ: "JWT", kid: signer.kid });
    expect(signer.kid).toMatch(/^local-[A-Za-z0-9_-]{16}$/);
  });

  it("derives the same key id from the same key", async () => {
    const key = await generateSigningKey();
    const [first, second] = await Promise.all([createSigner(key), createSigner(key)]);
    expect(first.kid).toBe(second.kid);
  });

  it("publishes only the public half of the key", async () => {
    const signer = await createSigner(await generateSigningKey());
    expect(signer.jwks.keys).toHaveLength(1);
    expect(signer.jwks.keys[0]).not.toHaveProperty("d");
  });

  it("produces tokens another key set rejects", async () => {
    const signer = await createSigner(await generateSigningKey());
    const stranger = await createSigner(await generateSigningKey());
    const token = await signer.sign(claims);

    await expect(
      jwtVerify(token, createLocalJWKSet(stranger.jwks), verifyAt(claims.iat)),
    ).rejects.toThrow();
  });
});
