// The MCP server over stdio. stdout carries the protocol, so this process never logs to it.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { privateKeyToAccount } from "viem/accounts";
import { createBuyer } from "./buyer";
import { loadConfig } from "./config";
import { createMcpServer } from "./mcp";

const config = loadConfig(process.env);
const buyer = createBuyer({ ...config, signer: privateKeyToAccount(config.privateKey) });
await createMcpServer(buyer).connect(new StdioServerTransport());
console.error(`tollgate-buyer MCP server ready, buying as ${config.agent}`);
