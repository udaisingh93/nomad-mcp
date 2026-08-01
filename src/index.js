#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

const server = new McpServer({ name: "nomad-mcp", version: "0.1.0" });

registerReadTools(server);

const writeModeEnabled = /^(1|true|on)$/i.test(process.env.NOMAD_MCP_WRITE_MODE || "");
if (writeModeEnabled) {
  registerWriteTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `nomad-mcp: connected. NOMAD_ADDR=${process.env.NOMAD_ADDR || "http://127.0.0.1:4646"} writeMode=${writeModeEnabled}\n`
);
