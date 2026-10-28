import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp";
import { useWorld } from "./world";

const world = useWorld();

// An MCP client talking to the server in memory, as Claude would over stdio.
async function connect(agent: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(world.buyerFor(agent)).connect(serverSide);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, string>) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return JSON.parse(first?.text ?? "null") as Record<string, unknown>;
}

describe("the MCP server", () => {
  it("offers pay_and_fetch and resume_purchase", async () => {
    const client = await connect("agt_unused");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["pay_and_fetch", "resume_purchase"]);
  });

  it("pays for a call and returns the data with a Basescan link", async () => {
    const { agent } = await world.newAgent();
    const client = await connect(agent);

    const result = await call(client, "pay_and_fetch", {
      url: `${world.sellerUrl}/v1/insight?topic=mcp`,
      maxAmount: "0.05",
      category: "data",
    });
    expect(result).toMatchObject({
      status: "delivered",
      data: { data: "Sample insight on mcp." },
      explorer: expect.stringMatching(
        /^https:\/\/sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/,
      ) as string,
    });
  });

  it("goes to review for $3, then pays once the operator approves", async () => {
    const { agent } = await world.newAgent();
    const client = await connect(agent);
    const url = `${world.sellerUrl}/v1/report?topic=mcp`;

    const asked = await call(client, "pay_and_fetch", { url, maxAmount: "5", category: "data" });
    expect(asked).toMatchObject({ status: "review" });

    const decision = asked.decision as string;
    const { review } = (await world.admin("GET", `/v1/decisions/${decision}`)) as {
      review: { review: string };
    };
    await world.admin("POST", `/v1/reviews/${review.review}/approve`);

    expect(await call(client, "resume_purchase", { url, decision })).toMatchObject({
      status: "delivered",
    });
  });

  it("rejects a maxAmount that isn't a dollar amount", async () => {
    const client = await connect("agt_unused");
    const result = await client.callTool({
      name: "pay_and_fetch",
      arguments: { url: `${world.sellerUrl}/v1/insight`, maxAmount: "0.01 USD", category: "data" },
    });
    expect(result.isError).toBe(true);
    expect(world.facilitator.calls).toEqual([]);
  });
});
