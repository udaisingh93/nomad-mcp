import { z } from "zod";
import { nomadRequest, requireWriteMode } from "../nomadClient.js";

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
}

const ALL_WRITE_TOOLS = ["stop_job", "scale_task_group", "restart_allocation", "register_job"];

function enabledWriteTools() {
  const list = process.env.NOMAD_MCP_WRITE_TOOLS;
  if (!list) return new Set(ALL_WRITE_TOOLS);
  return new Set(
    list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function registerWriteTools(server) {
  const enabled = enabledWriteTools();

  if (enabled.has("stop_job")) {
    server.tool(
      "stop_job",
      "Stop a Nomad job. Set purge=true to also remove it from Nomad's state entirely (cannot be undone via job history).",
      { id: z.string(), namespace: z.string().optional(), purge: z.boolean().default(false) },
      async ({ id, namespace, purge }) => {
        requireWriteMode();
        return json(
          await nomadRequest("DELETE", `/v1/job/${encodeURIComponent(id)}`, { query: { namespace, purge: purge ? "true" : undefined } })
        );
      }
    );
  }

  if (enabled.has("scale_task_group")) {
    server.tool(
      "scale_task_group",
      "Scale a task group within a job to a specific count.",
      {
        id: z.string(),
        group: z.string(),
        count: z.number().int().min(0),
        namespace: z.string().optional(),
        reason: z.string().optional(),
      },
      async ({ id, group, count, namespace, reason }) => {
        requireWriteMode();
        return json(
          await nomadRequest("POST", `/v1/job/${encodeURIComponent(id)}/scale`, {
            query: { namespace },
            body: { Target: { Group: group }, Count: count, Message: reason || "scaled via nomad-mcp" },
          })
        );
      }
    );
  }

  if (enabled.has("restart_allocation")) {
    server.tool(
      "restart_allocation",
      "Stop a single allocation, causing Nomad to reschedule it. Useful as a targeted 'restart' of one instance of a job.",
      { allocId: z.string() },
      async ({ allocId }) => {
        requireWriteMode();
        return json(await nomadRequest("POST", `/v1/allocation/${encodeURIComponent(allocId)}/stop`));
      }
    );
  }

  if (enabled.has("register_job")) {
    server.tool(
      "register_job",
      "Submit (create or update) a Nomad job. Accepts either a full Nomad job spec in HCL (jobHcl) or JSON (jobJson).",
      {
        jobHcl: z.string().optional().describe("Job spec in HCL format, as you'd write in a .nomad.hcl file"),
        jobJson: z.record(z.any()).optional().describe("Job spec as the Nomad JSON job object (the value of the top-level 'Job' key)"),
        namespace: z.string().optional(),
      },
      async ({ jobHcl, jobJson, namespace }) => {
        requireWriteMode();
        if (!jobHcl && !jobJson) throw new Error("Provide either jobHcl or jobJson");
        let job = jobJson;
        if (jobHcl) {
          job = await nomadRequest("POST", "/v1/jobs/parse", { body: { JobHCL: jobHcl, Canonicalize: true } });
        }
        return json(await nomadRequest("POST", "/v1/jobs", { query: { namespace }, body: { Job: job } }));
      }
    );
  }
}
