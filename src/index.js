#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

const VERSION = "0.2.0";
const NOMAD_ADDR = process.env.NOMAD_ADDR || "http://127.0.0.1:4646";
const writeModeEnabled = /^(1|true|on)$/i.test(process.env.NOMAD_MCP_WRITE_MODE || "");

// stdio (default): one client, the process that started us.
// http: streamable HTTP on MCP_HOST:MCP_PORT/mcp, stateless - a fresh server
// per request, since a McpServer is bound to one transport.
const transportMode = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

function buildServer() {
  const server = new McpServer({ name: "nomad-mcp", version: VERSION });
  registerReadTools(server);
  if (writeModeEnabled) {
    registerWriteTools(server);
  }
  return server;
}

function log(msg) {
  process.stderr.write(`nomad-mcp: ${msg}\n`);
}

if (transportMode === "stdio") {
  await buildServer().connect(new StdioServerTransport());
  log(`connected. NOMAD_ADDR=${NOMAD_ADDR} writeMode=${writeModeEnabled}`);
} else if (transportMode === "http") {
  serveHttp();
} else {
  log(`unknown MCP_TRANSPORT=${transportMode} (stdio or http)`);
  process.exit(2);
}

function serveHttp() {
  const host = process.env.MCP_HOST || "127.0.0.1";
  const port = Number(process.env.MCP_PORT || 8000);
  const token = process.env.MCP_AUTH_TOKEN || "";
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(host);

  // Anyone who can reach the port acts with NOMAD_TOKEN, and with write mode on
  // can stop and register jobs - so off loopback a bearer token is mandatory.
  if (!loopback && !token) {
    log(`refusing to listen on ${host} without MCP_AUTH_TOKEN`);
    process.exit(2);
  }

  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req) => {
    if (!token) return true;
    const got = Buffer.from(req.headers.authorization || "");
    return got.length === expected.length && timingSafeEqual(got, expected);
  };

  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const httpServer = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;

    if (path === "/health" && req.method === "GET") {
      return reply(res, 200, { status: "ok", writeMode: writeModeEnabled });
    }
    if (path !== "/mcp") {
      return reply(res, 404, { error: "not found" });
    }
    if (!authorized(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return reply(res, 401, { error: "unauthorized" });
    }
    // stateless: no session to stream on (GET) or to end (DELETE)
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return reply(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      log(`request failed: ${err?.stack || err}`);
      if (!res.headersSent) {
        reply(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  httpServer.listen(port, host, () => {
    log(
      `listening on http://${host}:${port}/mcp. NOMAD_ADDR=${NOMAD_ADDR} ` +
        `writeMode=${writeModeEnabled} auth=${token ? "bearer" : "none"}`
    );
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => httpServer.close(() => process.exit(0)));
  }
}
