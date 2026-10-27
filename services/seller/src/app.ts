import type { Db } from "@tollgate/db";
import { toBaseUnits, VERDICT_HEADER, type VerdictCheck } from "@tollgate/shared";
import type { FacilitatorClient } from "@x402/core/server";
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { claimDelivery, completeDelivery, type Delivery } from "./deliveries";
import { carriesPayment, paywall, settlementOf, signedPayment, type Product } from "./payment";
import { checkVerdict, type VerdictPolicy } from "./verdict";

export type Context = {
  db: Db;
  now: () => Date;
  payTo: string;
  asset: string;
  facilitator: FacilitatorClient;
  policy: VerdictPolicy;
};

// The $3 report exists so a purchase can go over the mandate's $2 review threshold.
export const PRODUCTS: Record<string, Product> = {
  "GET /v1/insight": { price: toBaseUnits("0.01"), description: "One market insight" },
  "GET /v1/report": { price: toBaseUnits("3"), description: "A full research report" },
};

export function createApp(ctx: Context) {
  const app = express();
  const pay = recordSettlement(ctx, paywall({ ...ctx, products: PRODUCTS }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  for (const [resource, product] of Object.entries(PRODUCTS)) {
    const path = resource.replace(/^GET /, "");
    app.get(path, requireVerdict(ctx, resource, product), pay, deliver(resource));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "route not found" } });
  });
  app.use(errorHandler);
  return app;
}

// Runs before x402, on paid requests only: a bad verdict never reaches the
// facilitator, and an unpaid price check never consumes a nonce.
function requireVerdict(ctx: Context, resource: string, product: Product): RequestHandler {
  return async (req, res, next) => {
    if (!carriesPayment(req)) return next();

    const token = req.get(VERDICT_HEADER);
    const sale = { amount: product.price, currency: "USD", recipient: ctx.payTo };
    const verdict = await checkVerdict(token, sale, ctx.policy, ctx.now());
    if (!verdict.ok) return refuse(res, verdict.check, verdict.reason);

    const claim = await claimDelivery(ctx.db, {
      approval: verdict.approval,
      token: token ?? "",
      recipient: ctx.payTo,
      resource,
      payment: signedPayment(req),
    });
    if (!claim.ok) return refuse(res, "nonce", claim.reason);

    res.locals.delivery = claim.delivery;
    next();
  };
}

// x402 settles after the handler has answered; once it's done, record the outcome.
function recordSettlement(ctx: Context, pay: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    await pay(req, res, next);
    const delivery = res.locals.delivery as Delivery | undefined;
    if (delivery) await completeDelivery(ctx.db, delivery.id, settlementOf(res), ctx.now());
  };
}

function deliver(resource: string): RequestHandler {
  return (req, res) => {
    const delivery = res.locals.delivery as Delivery;
    const topic = typeof req.query.topic === "string" ? req.query.topic : "usdc";
    res.json({
      resource,
      topic,
      delivery: delivery.id,
      decision: delivery.decisionId,
      data: `Sample ${resource === "GET /v1/report" ? "report" : "insight"} on ${topic}.`,
    });
  };
}

function refuse(res: Response, check: VerdictCheck, message: string): void {
  res.status(403).json({ error: { code: "verdict_rejected", check, message } });
}

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  console.error(error);
  // Recording a settlement can fail after the buyer already has their answer.
  if (res.headersSent) return;
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
};
