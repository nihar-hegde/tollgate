// The stateless part of Saifuro's seller-side check: everything except the nonce,
// which deliveries.ts records once this passes. ADR 0005.

import { toBaseUnits, type VerdictCheck } from "@tollgate/shared";
import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

// What this seller is about to settle.
export type Sale = {
  amount: bigint;
  currency: string;
  recipient: string;
};

export type VerdictPolicy = {
  keys: JWTVerifyGetKey;
  issuer: string;
  // A token that carries `aud` must name this seller.
  audience: string;
  kidPrefixes: readonly string[];
  operatorMandates: ReadonlySet<string>;
};

export type Approval = {
  decision: string;
  nonce: string;
  mandate: string;
  agent: string;
  supersedes: string | null;
  amount: bigint;
};

export type VerdictResult =
  { ok: true; approval: Approval } | { ok: false; check: VerdictCheck; reason: string };

const MAX_TOKEN_LENGTH = 4096;
// Three base64url segments. jose would also accept padding and whitespace.
const COMPACT_JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const MAX_FUTURE_IAT_SECONDS = 60;

const Claims = z.object({
  jti: z.string(),
  iat: z.number(),
  verdict: z.string(),
  mandate: z.string().nullish(),
  nonce: z.string().min(1),
  supersedes: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  request: z.object({
    agent: z.string(),
    // Saifuro signs a number, Tollgate a dollar string; both are compared as exact decimals.
    amount: z.union([z.string(), z.number()]),
    // Missing on verdicts issued before 9 Oct 2026.
    currency: z.string().optional(),
    recipient: z.string(),
  }),
});

export async function checkVerdict(
  token: string | undefined,
  sale: Sale,
  policy: VerdictPolicy,
  now: Date,
): Promise<VerdictResult> {
  if (!token) return reject("signature", "missing X-Verdict header");
  if (token.length > MAX_TOKEN_LENGTH) return reject("signature", "token is too long");
  if (!COMPACT_JWT.test(token)) return reject("signature", "token is not a compact JWT");

  let verified;
  try {
    verified = await jwtVerify(token, policy.keys, {
      issuer: policy.issuer,
      algorithms: ["ES256"],
      requiredClaims: ["exp", "iat", "nonce", "verdict", "request"],
      currentDate: now,
    });
  } catch (error) {
    return rejectionFor(error);
  }

  const kid = verified.protectedHeader.kid ?? "";
  if (!policy.kidPrefixes.some((prefix) => kid.startsWith(prefix))) {
    return reject("environment", `key "${kid}" is not accepted here`);
  }

  const parsed = Claims.safeParse(verified.payload);
  if (!parsed.success)
    return reject("claims", `malformed claims: ${z.prettifyError(parsed.error)}`);
  const claims = parsed.data;

  if (claims.iat > now.getTime() / 1000 + MAX_FUTURE_IAT_SECONDS) {
    return reject("expiry", "issued in the future");
  }
  return checkClaims(claims, sale, policy);
}

function checkClaims(
  claims: z.output<typeof Claims>,
  sale: Sale,
  policy: VerdictPolicy,
): VerdictResult {
  const { request } = claims;

  if (claims.verdict !== "allow")
    return reject("claims", `verdict is ${claims.verdict}, not allow`);
  if (!claims.mandate) return reject("claims", "an allow must name a mandate");
  if (claims.aud !== undefined && ![claims.aud].flat().includes(policy.audience)) {
    return reject("claims", "token is addressed to someone else");
  }

  const amount = exactAmount(request.amount);
  if (amount !== sale.amount) {
    return reject("claims", `amount ${String(request.amount)} does not match the price`);
  }
  if (request.currency !== sale.currency) {
    return reject("claims", `currency ${request.currency ?? "(missing)"} is not ${sale.currency}`);
  }
  if (request.recipient !== sale.recipient) {
    return reject("claims", `recipient ${request.recipient} is not this seller`);
  }
  if (!policy.operatorMandates.has(claims.mandate)) {
    return reject("claims", `mandate ${claims.mandate} is not registered with this seller`);
  }

  return {
    ok: true,
    approval: {
      decision: claims.jti,
      nonce: claims.nonce,
      mandate: claims.mandate,
      agent: request.agent,
      supersedes: claims.supersedes ?? null,
      amount,
    },
  };
}

function exactAmount(value: string | number): bigint | null {
  try {
    return toBaseUnits(String(value));
  } catch {
    return null;
  }
}

function rejectionFor(error: unknown): VerdictResult {
  if (error instanceof errors.JWKSTimeout) throw error;
  if (error instanceof errors.JWTExpired) return reject("expiry", "token has expired");
  if (error instanceof errors.JWTClaimValidationFailed && error.claim !== "iss") {
    return reject("claims", error.message);
  }
  if (error instanceof errors.JOSEError) return reject("signature", error.message);
  // An unreachable key set is our failure, not the buyer's.
  throw error;
}

function reject(check: VerdictCheck, reason: string): VerdictResult {
  return { ok: false, check, reason };
}
