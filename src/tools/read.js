import { z } from "zod";
import { nomadRequest } from "../nomadClient.js";

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerReadTools(server) {
  server.tool(
    "list_jobs",
    "List Nomad jobs, optionally filtered by name prefix and namespace.",
    { prefix: z.string().optional(), namespace: z.string().optional() },
    async ({ prefix, namespace }) => json(await nomadRequest("GET", "/v1/jobs", { query: { prefix, namespace } }))
  );

  server.tool(
    "get_job",
    "Get the full spec and status of a single Nomad job by ID.",
    { id: z.string(), namespace: z.string().optional() },
    async ({ id, namespace }) => json(await nomadRequest("GET", `/v1/job/${encodeURIComponent(id)}`, { query: { namespace } }))
  );

  server.tool(
    "get_job_allocations",
    "List allocations belonging to a job.",
    { id: z.string(), namespace: z.string().optional() },
    async ({ id, namespace }) =>
      json(await nomadRequest("GET", `/v1/job/${encodeURIComponent(id)}/allocations`, { query: { namespace } }))
  );

  server.tool(
    "get_job_deployments",
    "List deployments for a job.",
    { id: z.string(), namespace: z.string().optional() },
    async ({ id, namespace }) =>
      json(await nomadRequest("GET", `/v1/job/${encodeURIComponent(id)}/deployments`, { query: { namespace } }))
  );

  server.tool(
    "get_job_evaluations",
    "List evaluations for a job (useful for diagnosing why a job isn't placing).",
    { id: z.string(), namespace: z.string().optional() },
    async ({ id, namespace }) =>
      json(await nomadRequest("GET", `/v1/job/${encodeURIComponent(id)}/evaluations`, { query: { namespace } }))
  );

  server.tool(
    "get_allocation",
    "Get details of a single allocation, including task states and events.",
    { id: z.string() },
    async ({ id }) => json(await nomadRequest("GET", `/v1/allocation/${encodeURIComponent(id)}`))
  );

  server.tool(
    "get_allocation_logs",
    "Fetch recent stdout/stderr log output for a task in an allocation.",
    {
      allocId: z.string(),
      task: z.string().describe("Task name within the allocation"),
      type: z.enum(["stdout", "stderr"]).default("stdout"),
      tailBytes: z.number().int().positive().max(1_000_000).default(4000),
    },
    async ({ allocId, task, type, tailBytes }) => {
      const text = await nomadRequest("GET", `/v1/client/fs/logs/${encodeURIComponent(allocId)}`, {
        query: { task, type, origin: "end", offset: String(tailBytes), plain: "true" },
        raw: true,
      });
      return { content: [{ type: "text", text: text || "(no log output)" }] };
    }
  );

  server.tool(
    "list_nodes",
    "List client nodes in the Nomad cluster.",
    {},
    async () => json(await nomadRequest("GET", "/v1/nodes"))
  );

  server.tool(
    "get_node",
    "Get details of a single Nomad client node, including allocations and resource usage.",
    { id: z.string() },
    async ({ id }) => json(await nomadRequest("GET", `/v1/node/${encodeURIComponent(id)}`))
  );

  server.tool(
    "list_deployments",
    "List recent deployments across the cluster.",
    { namespace: z.string().optional() },
    async ({ namespace }) => json(await nomadRequest("GET", "/v1/deployments", { query: { namespace } }))
  );

  server.tool(
    "get_deployment",
    "Get details of a single deployment.",
    { id: z.string() },
    async ({ id }) => json(await nomadRequest("GET", `/v1/deployment/${encodeURIComponent(id)}`))
  );

  server.tool(
    "list_namespaces",
    "List Nomad namespaces.",
    {},
    async () => json(await nomadRequest("GET", "/v1/namespaces"))
  );
}
