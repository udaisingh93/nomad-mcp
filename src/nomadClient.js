import { fetch, Agent } from "undici";
import { readFileSync } from "node:fs";

const NOMAD_ADDR = (process.env.NOMAD_ADDR || "http://127.0.0.1:4646").replace(/\/+$/, "");
const NOMAD_TOKEN = process.env.NOMAD_TOKEN || "";
const NOMAD_NAMESPACE = process.env.NOMAD_NAMESPACE || "";
const NOMAD_SKIP_VERIFY = /^(1|true)$/i.test(process.env.NOMAD_SKIP_VERIFY || "");
const NOMAD_CACERT = process.env.NOMAD_CACERT || "";

const dispatcher =
  NOMAD_SKIP_VERIFY || NOMAD_CACERT
    ? new Agent({
        connect: {
          rejectUnauthorized: !NOMAD_SKIP_VERIFY,
          ca: NOMAD_CACERT ? readFileSync(NOMAD_CACERT) : undefined,
        },
      })
    : undefined;

class NomadApiError extends Error {
  constructor(status, body, path) {
    super(`Nomad API ${status} on ${path}: ${body}`);
    this.name = "NomadApiError";
    this.status = status;
  }
}

/**
 * @param {string} method
 * @param {string} path e.g. "/v1/jobs"
 * @param {{ query?: Record<string, string|undefined>, body?: unknown, raw?: boolean }} [opts]
 * raw: true returns response text instead of parsing JSON (for log endpoints)
 */
export async function nomadRequest(method, path, opts = {}) {
  const url = new URL(NOMAD_ADDR + path);
  const query = { ...opts.query };
  if (NOMAD_NAMESPACE && !query.namespace) query.namespace = NOMAD_NAMESPACE;
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = { Accept: "application/json" };
  if (NOMAD_TOKEN) headers["X-Nomad-Token"] = NOMAD_TOKEN;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    dispatcher,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new NomadApiError(res.status, text, path);
  }
  if (opts.raw) return text;
  if (!text) return null;
  return JSON.parse(text);
}

export function requireWriteMode() {
  const enabled = /^(1|true|on)$/i.test(process.env.NOMAD_MCP_WRITE_MODE || "");
  if (!enabled) {
    throw new Error(
      "Write tools are disabled. Set NOMAD_MCP_WRITE_MODE=on to enable this nomad-mcp server to make changes to the cluster."
    );
  }
}
