import { EvmAddress, VERDICT_ISSUER } from "@tollgate/shared";
import { z } from "zod";

const List = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const Env = z.object({
  DATABASE_URL: z.url(),
  SELLER_URL: z.url().default("http://localhost:4001"),
  // The seller's wallet: the x402 payTo, and the recipient every verdict must name.
  SELLER_ADDRESS: EvmAddress,
  USDC_ADDRESS: EvmAddress,
  X402_FACILITATOR_URL: z.url().default("https://x402.org/facilitator"),
  AUTHORIZER_URL: z.url().default("http://localhost:4000"),
  // Pointing these at Saifuro (and the kid prefixes at their production keys) is the whole switch.
  VERDICT_ISSUER: z.string().min(1).default(VERDICT_ISSUER),
  VERDICT_JWKS_URL: z.url().optional(),
  ACCEPTED_KID_PREFIXES: List.default(["local-"]).pipe(z.array(z.string()).min(1)),
  OPERATOR_MANDATES: List.pipe(
    z.array(z.string().regex(/^mnd_\w+$/)).min(1, "list the mandate ids your operator gave you"),
  ),
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid seller config:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;

  return {
    databaseUrl: e.DATABASE_URL,
    url: e.SELLER_URL,
    port: Number(new URL(e.SELLER_URL).port || 80),
    payTo: e.SELLER_ADDRESS,
    asset: e.USDC_ADDRESS,
    facilitatorUrl: e.X402_FACILITATOR_URL,
    issuer: e.VERDICT_ISSUER,
    jwksUrl: e.VERDICT_JWKS_URL ?? `${e.AUTHORIZER_URL}/.well-known/jwks.json`,
    kidPrefixes: e.ACCEPTED_KID_PREFIXES,
    operatorMandates: new Set(e.OPERATOR_MANDATES),
  };
}
