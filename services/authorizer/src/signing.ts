import type { VerdictClaims } from "@tollgate/shared";
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWK,
  type JWK_EC_Private,
} from "jose";

export type Signer = {
  kid: string;
  jwks: { keys: JWK[] };
  sign(claims: VerdictClaims): Promise<string>;
};

export async function createSigner(privateJwk: JWK_EC_Private): Promise<Signer> {
  const key = await importJWK(privateJwk, "ES256");
  const { crv, x, y } = privateJwk;
  const publicJwk = { kty: "EC", crv, x, y };
  // `local-` marks the key as this stand-in's, never a Saifuro production or sandbox key.
  const kid = `local-${(await calculateJwkThumbprint(publicJwk)).slice(0, 16)}`;

  return {
    kid,
    jwks: { keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] },
    sign: (claims) =>
      new SignJWT(claims).setProtectedHeader({ alg: "ES256", typ: "JWT", kid }).sign(key),
  };
}

export async function generateSigningKey(): Promise<JWK_EC_Private> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  // An ES256 private key always exports as an EC private JWK.
  return (await exportJWK(privateKey)) as JWK_EC_Private;
}
