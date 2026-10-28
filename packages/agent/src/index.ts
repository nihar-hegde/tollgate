// @tollgate/agent: the buyer, its CLI (src/cli.ts) and its MCP server (src/mcp-stdio.ts).
export { createBuyer, type BuyerConfig, type Outcome, type Purchase } from "./buyer";
export { createMcpServer } from "./mcp";
