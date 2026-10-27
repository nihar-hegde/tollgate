// Zod schemas for data crossing service boundaries, with Saifuro's field
// names. Parsing turns dollar strings into bigint base units, so code past the
// edge never handles a dollar amount.

import { z } from "zod";
import { toBaseUnits } from "./amounts";
import { PROTOCOLS, type MandateStatus } from "./codes";
import { AGENT_ID, idPattern } from "./ids";

// "0.01" → 10000n. The rules live in toBaseUnits; this only reports its error.
// Strings only: a JSON number like 0.01 has already been through a float.
export const DollarAmount = z.string().transform((value, ctx) => {
  try {
    return toBaseUnits(value);
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});

// Lowercase only, matched exactly (ADR 0002).
export const Category = z
  .string()
  .regex(/^[a-z0-9_]{1,32}$/, "category must be lowercase letters, digits or underscores");

// Any three-letter code is a well-formed request; a currency with no mandate
// is a decision (deny_no_mandate), not a bad request. Case-sensitive.
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, "currency must be like USD");

// Tollgate settles in USDC, so mandates are always in USD.
export const MandateCurrency = z.literal("USD");

// The seller's payTo address: the verdict names exactly where the money goes.
export const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

export const AgentId = z.string().regex(AGENT_ID, "agent must look like agt_research_01");
export const MandateId = z.string().regex(idPattern("mandate"), "not a mandate id");

// POST /v1/authorizations body. Unknown fields are rejected.
export const AuthorizationRequest = z.strictObject({
  agent: AgentId,
  amount: DollarAmount,
  currency: CurrencyCode,
  recipient: EvmAddress,
  category: Category,
  protocol: z.enum(PROTOCOLS).optional(),
});
export type AuthorizationRequest = z.output<typeof AuthorizationRequest>;

// What an operator submits to create a mandate. Saifuro's shape; limits are
// dollar strings in, base units out.
export const MandateInput = z
  .strictObject({
    agent: AgentId,
    principal: z.string().trim().min(1).max(128),
    limits: z.strictObject({
      per_transaction: DollarAmount,
      per_month: DollarAmount,
      currency: MandateCurrency,
    }),
    categories: z
      .array(Category)
      .min(1)
      .refine((list) => new Set(list).size === list.length, "categories must not repeat"),
    review_above: DollarAmount.optional(),
    // Valid through the end of this day, UTC (ADR 0002).
    expires: z.iso.date(),
  })
  .refine((m) => m.limits.per_transaction <= m.limits.per_month, {
    message: "per_transaction cannot exceed per_month",
    path: ["limits", "per_transaction"],
  });
export type MandateInput = z.output<typeof MandateInput>;

// A stored mandate: the input plus what the authorizer assigns.
export type Mandate = MandateInput & {
  mandate: string;
  status: MandateStatus;
  replaces?: string;
  created_at: Date;
};
