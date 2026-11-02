// The buyer's whole flow: learn the price, ask permission for exactly that, and pay only on allow.
// Fails closed: anything unexpected before the paid request means nothing is signed or sent.

import { randomUUID } from "node:crypto";
import { fromBaseUnits, toBaseUnits, VERDICT_HEADER } from "@tollgate/shared";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { z } from "zod";

export const NETWORK = "eip155:84532";
const AUTHORIZER_TIMEOUT_MS = 10_000;
// Settlement waits for the transaction to land on Base Sepolia.
const SELLER_TIMEOUT_MS = 60_000;

export type BuyerConfig = {
  authorizerUrl: string;
  agentKey: string;
  agent: string;
  // The USDC contract this buyer is willing to pay in.
  asset: string;
  signer: ConstructorParameters<typeof ExactEvmScheme>[0];
};

export type Purchase = { url: string; maxAmount: bigint; category: string };

export type Outcome =
  | { status: "delivered"; decision: string; txHash: string | null; data: unknown }
  | { status: "review"; decision: string; reason: string }
  | { status: "denied"; decision: string; verdict: string; reason: string }
  // Nothing was paid, unless `reason` says the payment may still have settled.
  | { status: "refused"; reason: string };

// The parts of the authorizer's decision the buyer acts on.
const Decision = z.object({
  decision: z.string(),
  verdict: z.string(),
  reason: z.string(),
  verdict_token: z.string(),
  request: z.object({ amount: z.string(), recipient: z.string() }),
  superseded_by: z.string().nullable(),
  review: z.object({ status: z.string() }).nullable(),
});
type Decision = z.output<typeof Decision>;

export function createBuyer(config: BuyerConfig) {
  // Our own check is stricter than x402's default $1 cap: the price must equal the approved amount exactly.
  const payments = new x402HTTPClient(
    new x402Client().register(NETWORK, new ExactEvmScheme(config.signer)).setSpendControls(false),
  );

  async function payAndFetch({ url, maxAmount, category }: Purchase): Promise<Outcome> {
    return failClosed(async () => {
      const offer = await priceOf(url);
      const price = BigInt(offer.option.amount);
      if (price > maxAmount) {
        throw new Error(
          `price ${fromBaseUnits(price)} is above maxAmount ${fromBaseUnits(maxAmount)}`,
        );
      }

      const decision = await authorize(price, offer.option.payTo, category);
      if (decision.verdict === "review") {
        return { status: "review", decision: decision.decision, reason: decision.reason };
      }
      if (decision.verdict !== "allow") {
        const { verdict, reason } = decision;
        return { status: "denied", decision: decision.decision, verdict, reason };
      }
      return pay(url, offer, decision);
    });
  }

  // After a review: pay with the allow the operator's approval issued, if there is one yet.
  async function resume(url: string, reviewDecision: string): Promise<Outcome> {
    return failClosed(async () => {
      const original = await decisionById(reviewDecision);
      if (original.superseded_by === null) {
        const status = original.review?.status ?? "not a review";
        if (status === "pending") {
          return { status: "review", decision: original.decision, reason: "still waiting" };
        }
        throw new Error(`review ${reviewDecision} is ${status}`);
      }

      const approval = await decisionById(original.superseded_by);
      const offer = await priceOf(url);
      // The price or payee may have changed while the review waited.
      if (
        BigInt(offer.option.amount) !== toBaseUnits(approval.request.amount) ||
        offer.option.payTo !== approval.request.recipient
      ) {
        throw new Error("the seller's price or payTo no longer matches the approval");
      }
      return pay(url, offer, approval);
    });
  }

  // The free first call: the 402 names the exact price and payee.
  async function priceOf(url: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(SELLER_TIMEOUT_MS) });
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (response.status !== 402 || header === null) {
      throw new Error(`expected a 402 with a price from ${url}, got ${response.status}`);
    }
    const required = decodePaymentRequiredHeader(header);
    const option = required.accepts.find(
      (o) =>
        o.scheme === "exact" &&
        o.network === NETWORK &&
        o.asset.toLowerCase() === config.asset.toLowerCase(),
    );
    if (!option) throw new Error("the seller doesn't accept USDC on Base Sepolia");
    return { required, option };
  }

  async function authorize(amount: bigint, recipient: string, category: string) {
    return callAuthorizer("POST", "/v1/authorizations", {
      agent: config.agent,
      amount: fromBaseUnits(amount),
      currency: "USD",
      recipient,
      category,
      protocol: "x402",
    });
  }

  function decisionById(id: string) {
    return callAuthorizer("GET", `/v1/decisions/${encodeURIComponent(id)}`);
  }

  async function callAuthorizer(method: string, path: string, body?: unknown): Promise<Decision> {
    let response: Response;
    try {
      response = await fetch(`${config.authorizerUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.agentKey}`,
          ...(body !== undefined && {
            "Content-Type": "application/json",
            "Idempotency-Key": `purchase_${randomUUID()}`,
          }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(AUTHORIZER_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`authorizer unreachable, so no payment: ${messageOf(error)}`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const why = body?.error?.message ? ` (${body.error.message})` : "";
      throw new Error(`authorizer answered ${response.status}${why}, so no payment`);
    }
    return Decision.parse(await response.json());
  }

  // Signs exactly the option that was approved, then sends it with the verdict.
  async function pay(
    url: string,
    { required, option }: { required: PaymentRequired; option: PaymentRequirements },
    decision: Decision,
  ): Promise<Outcome> {
    const payload = await payments.createPaymentPayload({ ...required, accepts: [option] });
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          ...payments.encodePaymentSignatureHeader(payload),
          [VERDICT_HEADER]: decision.verdict_token,
        },
        signal: AbortSignal.timeout(SELLER_TIMEOUT_MS),
      });
    } catch (error) {
      // The payment may have settled anyway; the seller's delivery record will say.
      throw new Error(
        `no answer from the seller for decision ${decision.decision}: ${messageOf(error)}`,
      );
    }

    if (response.status === 403) {
      const { error } = (await response.json()) as { error?: { check?: string; message?: string } };
      throw new Error(`seller refused the verdict (${error?.check}): ${error?.message}`);
    }
    if (response.status >= 500) {
      throw new Error(
        `seller error ${response.status} after the payment was sent; it may still have settled, ` +
          `so check decision ${decision.decision} before trying again`,
      );
    }
    if (!response.ok) {
      const header = response.headers.get("PAYMENT-REQUIRED");
      const why = header ? decodePaymentRequiredHeader(header).error : undefined;
      throw new Error(`payment failed (${response.status}): ${why ?? "no reason given"}`);
    }

    // Paid by now, so nothing below may turn this into a refusal.
    return {
      status: "delivered",
      decision: decision.decision,
      txHash: transactionIn(response.headers.get("PAYMENT-RESPONSE")),
      data: await response.json().catch(() => null),
    };
  }

  return { payAndFetch, resume };
}

async function failClosed(attempt: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await attempt();
  } catch (error) {
    return { status: "refused", reason: messageOf(error) };
  }
}

function transactionIn(header: string | null): string | null {
  try {
    return header ? decodePaymentResponseHeader(header).transaction : null;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
