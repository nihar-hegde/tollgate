import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

export function decodeToken(token: string) {
  return { header: decodeProtectedHeader(token), payload: decodeJwt(token) };
}

export type SignatureCheck = { valid: true; kid: string } | { valid: false; reason: string };

// For the auditor: is this the authorizer's signature? The clock is set to when it was issued,
// since every verdict has long expired by the time anyone audits it.
export async function checkSignature(token: string, jwksUrl: string): Promise<SignatureCheck> {
  const { iat } = decodeJwt(token);
  try {
    const { protectedHeader } = await jwtVerify(token, createRemoteJWKSet(new URL(jwksUrl)), {
      algorithms: ["ES256"],
      currentDate: new Date((iat ?? 0) * 1000),
    });
    return { valid: true, kid: protectedHeader.kid ?? "" };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
