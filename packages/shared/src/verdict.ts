import type { Verdict } from "./codes";

export const VERDICT_ISSUER = "tollgate-local-authorizer";
export const VERDICT_TTL_SECONDS = 300;

// Saifuro doesn't name a header for sending a verdict with an x402 payment; this is Tollgate's.
export const VERDICT_HEADER = "X-Verdict";

// Signed claims. `request.amount` is a dollar string, like everywhere on the wire (ADR 0002 rule 7).
export type VerdictClaims = {
  iss: string;
  jti: string;
  iat: number;
  exp: number;
  verdict: Verdict;
  mandate: string | null;
  policy_version: string;
  nonce: string;
  request: {
    agent: string;
    amount: string;
    currency: string;
    recipient: string;
    category: string;
  };
  supersedes?: string;
};
