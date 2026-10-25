// Fixed vocabularies, spelled exactly as in Saifuro's docs.

// The eight decision codes. The deny codes are listed in the order the gates
// run (ADR 0002); `review` is the last gate and `allow` means every gate passed.
export const VERDICTS = [
  "deny_no_mandate",
  "deny_revoked",
  "deny_expired",
  "deny_category",
  "deny_limit",
  "deny_velocity",
  "review",
  "allow",
] as const;
export type Verdict = (typeof VERDICTS)[number];

// The checks a seller names when it rejects a verdict with a 403.
export const VERDICT_CHECKS = ["signature", "expiry", "environment", "nonce", "claims"] as const;
export type VerdictCheck = (typeof VERDICT_CHECKS)[number];

// Environment-wide enforcement switch, stamped on every decision.
export const MODES = ["observe", "enforce"] as const;
export type Mode = (typeof MODES)[number];

// A mandate only ever moves from active to revoked.
export const MANDATE_STATUSES = ["active", "revoked"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

// Optional label on an authorization request. Not signed, not used for routing.
export const PROTOCOLS = ["x402", "mpp", "acp", "ap2", "card"] as const;
export type Protocol = (typeof PROTOCOLS)[number];
