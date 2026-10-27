import { EvmAddress } from "@tollgate/shared";
import type { FacilitatorClient, RouteConfig } from "@x402/core/server";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Settlement } from "./deliveries";

export const NETWORK = "eip155:84532" as const;
// USDC's EIP-712 domain on Base Sepolia, which the buyer signs the payment against.
const USDC_DOMAIN = { name: "USDC", version: "2" };

export type Product = { price: bigint; description: string };

type Paywall = {
  products: Record<string, Product>;
  facilitator: FacilitatorClient;
  payTo: string;
  asset: string;
};

// x402 answers an unpaid request with 402 and the price; a paid one it verifies,
// runs the handler, then settles only if the handler succeeded.
export function paywall({ products, facilitator, payTo, asset }: Paywall): RequestHandler {
  const routes = Object.fromEntries(
    Object.entries(products).map(([route, product]) => [route, routeFor(product, payTo, asset)]),
  );
  const server = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());
  return paymentMiddleware(routes, server);
}

function routeFor({ price, description }: Product, payTo: string, asset: string): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo,
      // An exact amount in base units, so the money path never goes through a float.
      price: { asset, amount: price.toString(), extra: USDC_DOMAIN },
    },
    description,
    mimeType: "application/json",
  };
}

// The same test x402 uses, so a request is never "unpaid" to us but "paid" to x402.
export function carriesPayment(req: Request): boolean {
  return Boolean(paymentHeader(req));
}

export type SignedPayment = { payer: string; authorizationNonce: string };

const Exact = z.object({
  authorization: z.object({ from: EvmAddress, nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
});

// Who signed the payment and its EIP-3009 nonce, as the buyer claims them. Unchecked here:
// the indexer only uses them to find the matching transfer on-chain.
export function signedPayment(req: Request): SignedPayment | null {
  try {
    const { payload } = decodePaymentSignatureHeader(paymentHeader(req) ?? "");
    const { authorization } = Exact.parse(payload);
    return { payer: authorization.from, authorizationNonce: authorization.nonce.toLowerCase() };
  } catch {
    return null;
  }
}

function paymentHeader(req: Request): string | undefined {
  return req.get("PAYMENT-SIGNATURE") || req.get("X-PAYMENT");
}

// Reads how settlement went from the response x402 sent.
export function settlementOf(res: Response): Settlement {
  const response = res.getHeader("PAYMENT-RESPONSE");
  if (typeof response === "string") {
    const result = decodePaymentResponseHeader(response);
    return result.success
      ? { settled: true, txHash: result.transaction, payer: result.payer ?? null }
      : { settled: false, failure: result.errorReason ?? "settlement failed" };
  }
  const required = res.getHeader("PAYMENT-REQUIRED");
  if (typeof required === "string") {
    return {
      settled: false,
      failure: decodePaymentRequiredHeader(required).error ?? "payment rejected",
    };
  }
  return { settled: false, failure: `not settled (HTTP ${res.statusCode})` };
}
