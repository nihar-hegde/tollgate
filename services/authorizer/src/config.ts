import { MODES } from "@tollgate/shared";
import { z } from "zod";
import type { ApiKeys } from "./app";

const KEYGEN = "run `pnpm --filter @tollgate/authorizer keygen`";

const SigningKey = z
  .string({ error: `missing; ${KEYGEN}` })
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a private JWK as JSON" });
      return z.NEVER;
    }
  })
  .pipe(
    z.object({
      kty: z.literal("EC"),
      crv: z.literal("P-256"),
      x: z.string(),
      y: z.string(),
      d: z.string(),
    }),
  );

const Env = z.object({
  DATABASE_URL: z.url(),
  AUTHORIZER_URL: z.url().default("http://localhost:4000"),
  AUTHORIZER_MODE: z.enum(MODES).default("enforce"),
  AUTHORIZER_POLICY_VERSION: z.string().min(1).default("pol_local.1"),
  AUTHORIZER_SIGNING_KEY: SigningKey,
  AUTHORIZER_AGENT_KEY: z.string({ error: `missing; ${KEYGEN}` }).regex(/^ak_local_[0-9a-f]{32}$/),
  AUTHORIZER_SECRET_KEY: z.string({ error: `missing; ${KEYGEN}` }).regex(/^sk_local_[0-9a-f]{32}$/),
});

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid authorizer config:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const apiKeys: ApiKeys = { agent: e.AUTHORIZER_AGENT_KEY, secret: e.AUTHORIZER_SECRET_KEY };

  return {
    databaseUrl: e.DATABASE_URL,
    url: e.AUTHORIZER_URL,
    port: Number(new URL(e.AUTHORIZER_URL).port || 80),
    mode: e.AUTHORIZER_MODE,
    policyVersion: e.AUTHORIZER_POLICY_VERSION,
    signingKey: e.AUTHORIZER_SIGNING_KEY,
    apiKeys,
  };
}
