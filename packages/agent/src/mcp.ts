// The buyer as MCP tools, so Claude (or any MCP client) can buy data; same flow as the CLI.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toBaseUnits } from "@tollgate/shared";
import { z } from "zod";
import type { createBuyer, Outcome } from "./buyer";

type Buyer = ReturnType<typeof createBuyer>;

const EXPLORER = "https://sepolia.basescan.org/tx";

export function createMcpServer(buyer: Buyer): McpServer {
  const server = new McpServer({ name: "tollgate-buyer", version: "0.1.0" });

  server.registerTool(
    "pay_and_fetch",
    {
      title: "Pay for and fetch a paid API",
      description:
        "Buys one response from an x402 paid URL with testnet USDC on Base Sepolia. It first learns the price, " +
        "asks the spending authorizer for exactly that amount, and pays only if the answer is allow. Returns the " +
        "data and the transaction, or why nothing was paid: review (an operator must approve; then call " +
        "resume_purchase), denied (with the reason), or refused (the buyer stopped, e.g. over maxAmount).",
      inputSchema: {
        url: z
          .url()
          .describe("The paid endpoint, e.g. http://localhost:4001/v1/insight?topic=usdc"),
        maxAmount: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .describe("The most to pay for this call, in dollars, e.g. 0.05"),
        category: z.string().describe("Spending category to request, e.g. data"),
      },
    },
    async ({ url, maxAmount, category }) =>
      toolResult(await buyer.payAndFetch({ url, maxAmount: toBaseUnits(maxAmount), category })),
  );

  server.registerTool(
    "resume_purchase",
    {
      title: "Finish a purchase that went to review",
      description:
        "After pay_and_fetch returned review: pays with the operator's approval if there is one yet, or says " +
        "it is still waiting, was denied, or expired.",
      inputSchema: {
        url: z.url().describe("The same URL as the original purchase"),
        decision: z.string().describe("The decision id pay_and_fetch returned with status review"),
      },
    },
    async ({ url, decision }) => toolResult(await buyer.resume(url, decision)),
  );

  return server;
}

// Every outcome is a normal answer for the model to read, including denials.
function toolResult(outcome: Outcome) {
  const explorer =
    outcome.status === "delivered" && outcome.txHash
      ? { explorer: `${EXPLORER}/${outcome.txHash}` }
      : {};
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ ...outcome, ...explorer }, null, 2) },
    ],
  };
}
