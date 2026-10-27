import { AgentId, AgentInput, AuthorizationRequest, MandateInput } from "@tollgate/shared";
import express, { type Express } from "express";
import { z } from "zod";
import { createAgent, disableAgent, listAgents } from "./agents";
import type { Context } from "./context";
import { authorize, loadDecision } from "./decisions";
import { ApiError, notFound } from "./errors";
import { errorHandler, parse, requireKey } from "./http";
import { createMandate, listMandates, replaceMandate, revokeMandate } from "./mandates";
import { agentView, decisionView, mandateView } from "./mapping";
import { approveReview, denyReview } from "./reviews";

// Agents only ask for decisions; the secret key (the console) manages agents, mandates and reviews.
export type ApiKeys = { agent: string; secret: string };

const IdempotencyKey = z.string().min(1).max(255);

export function createApp(ctx: Context, keys: ApiKeys): Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  const agentKey = requireKey(keys.agent);
  const secretKey = requireKey(keys.secret);
  const eitherKey = requireKey(keys.agent, keys.secret);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Five minutes, as Saifuro's key set allows.
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").json(ctx.signer.jwks);
  });

  app.post("/v1/authorizations", agentKey, async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (idempotencyKey === undefined) {
      throw new ApiError(400, "idempotency_key_required", "send an Idempotency-Key header");
    }
    const { replayed, ...record } = await authorize(ctx, {
      request: parse(AuthorizationRequest, req.body),
      idempotencyKey: parse(IdempotencyKey, idempotencyKey),
    });
    res.set("Idempotent-Replayed", String(replayed)).json(decisionView(record, ctx.now()));
  });

  app.get<{ id: string }>("/v1/decisions/:id", eitherKey, async (req, res) => {
    const record = await loadDecision(ctx.db, req.params.id);
    if (!record) throw notFound(`decision ${req.params.id}`);
    res.json(decisionView(record, ctx.now()));
  });

  app.post("/v1/agents", secretKey, async (req, res) => {
    const agent = await createAgent(ctx, parse(AgentInput, req.body));
    res.status(201).json(agentView(agent));
  });

  app.get("/v1/agents", secretKey, async (_req, res) => {
    res.json({ agents: (await listAgents(ctx)).map(agentView) });
  });

  app.post<{ id: string }>("/v1/agents/:id/disable", secretKey, async (req, res) => {
    res.json(agentView(await disableAgent(ctx, req.params.id)));
  });

  app.post("/v1/mandates", secretKey, async (req, res) => {
    const mandate = await createMandate(ctx, parse(MandateInput, req.body));
    res.status(201).json(mandateView(mandate));
  });

  app.get("/v1/mandates", secretKey, async (req, res) => {
    const agent = parse(AgentId, req.query.agent);
    res.json({ mandates: (await listMandates(ctx, agent)).map(mandateView) });
  });

  app.post<{ id: string }>("/v1/mandates/:id/revoke", secretKey, async (req, res) => {
    res.json(mandateView(await revokeMandate(ctx, req.params.id)));
  });

  app.post<{ id: string }>("/v1/mandates/:id/replace", secretKey, async (req, res) => {
    const mandate = await replaceMandate(ctx, req.params.id, parse(MandateInput, req.body));
    res.status(201).json(mandateView(mandate));
  });

  app.post<{ id: string }>("/v1/reviews/:id/approve", secretKey, async (req, res) => {
    res.json(decisionView(await approveReview(ctx, req.params.id), ctx.now()));
  });

  app.post<{ id: string }>("/v1/reviews/:id/deny", secretKey, async (req, res) => {
    res.json(decisionView(await denyReview(ctx, req.params.id), ctx.now()));
  });

  app.use(() => {
    throw notFound("route");
  });
  app.use(errorHandler);
  return app;
}
