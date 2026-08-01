# Automating Nomad tasks with nomad-mcp

`nomad-mcp` is just an MCP server — the "automation" comes from pointing an
agent (Claude Code, OpenCode, etc.) at it, either interactively or headlessly
via a scheduled job. This doc covers both, plus a set of recipes for common
Nomad operations tasks.

## Two ways to automate

### 1. Interactive — you drive, the agent uses the tools

Connect the server (see README) and just ask in plain language. The agent
picks the right tool calls:

> "Any allocations failing right now? Show me the logs for whichever one is
> crash-looping."

> "Scale `screen-smallcaps` down to 0, I'm redeploying the box."

This is the normal case and needs nothing beyond the README setup.

### 2. Headless — a scheduled agent run with no human in the loop

For recurring tasks (health checks, auto-restart-on-failure, scheduled
scaling), run the agent non-interactively from cron/systemd/Task Scheduler
with a fixed prompt. Both Claude Code and OpenCode support a one-shot,
non-interactive mode:

```sh
# Claude Code
claude -p "Check nomad-console-prod for failed allocations. If any task group \
has 0 running allocations and the job isn't intentionally stopped, restart it \
with restart_allocation. Report what you did in one paragraph." \
  --mcp-config nomad-mcp.json

# OpenCode
opencode run "Check nomad-console-prod for failed allocations..." \
  --mcp nomad
```

`nomad-mcp.json` here is a minimal MCP config scoped to just this server:

```json
{
  "mcpServers": {
    "nomad": {
      "command": "node",
      "args": ["/path/to/nomad-mcp/src/index.js"],
      "env": {
        "NOMAD_ADDR": "https://nomad.example.com",
        "NOMAD_TOKEN": "your-scoped-token",
        "NOMAD_MCP_WRITE_MODE": "on",
        "NOMAD_MCP_WRITE_TOOLS": "restart_allocation"
      }
    }
  }
}
```

Wire that command into cron (`crontab -e`) or a systemd timer / scheduled
task, and you have a self-driving Nomad watchdog. Redirect stdout to a log
file so you have a record of what the agent decided each run:

```cron
*/10 * * * * claude -p "$(cat /etc/nomad-mcp/healthcheck-prompt.txt)" \
  --mcp-config /etc/nomad-mcp/nomad-mcp.json >> /var/log/nomad-agent.log 2>&1
```

**Before doing this**, read the [Security notes](README.md#security-notes)
in the README — a headless agent with write access acts without anyone
reviewing its calls in the moment. Scope `NOMAD_TOKEN` to an ACL policy that
covers only what the automation needs, and use `NOMAD_MCP_WRITE_TOOLS` to
limit which write tools are even reachable, not just what the prompt asks
for.

## Recipes

Each of these is a prompt you can hand to an agent connected to nomad-mcp —
interactively, or as the fixed prompt in a headless run.

### Health report

> "List all jobs and their status. For any job that isn't `running` or
> `dead` as expected, get its evaluations and explain why. Summarize in a
> table."

Tools used: `list_jobs`, `get_job_evaluations`.

### Auto-heal a crash-looping job

> "Get allocations for job `<id>`. If any allocation's ClientStatus is
> `failed`, fetch its logs (both stdout and stderr, last 4000 bytes) and
> tell me what's failing. If it looks like a transient error (not a config
> or code problem), restart that allocation."

Tools used: `get_job_allocations`, `get_allocation_logs`, `reschedule_allocation`
(new allocation, in case the failure is node-specific) or `restart_allocation`
(same allocation, if you want to preserve placement).

### Scheduled scale-down/scale-up

> "It's after 8pm — scale `batch-worker`'s `worker` group to 0. Confirm the
> scale succeeded before finishing."

Tools used: `scale_task_group`.

Run this as two cron entries with different prompts (scale to 0 at night,
scale back up in the morning) instead of one script — the agent verifying
the scale actually took effect (rather than just firing the call) is the
point of using an agent here instead of a raw `curl`.

### Rolling restart of every allocation in a job

> "Restart every running allocation of `nomad-console-prod`, one at a time,
> waiting for each to report `running` again before restarting the next."

Tools used: `get_job_allocations`, `restart_allocation`, `get_allocation`
(polled to confirm health before moving to the next allocation).

### Deploy from a spec file

> "Here's an updated job spec: [paste HCL]. Parse it, show me a summary of
> what's changing (image tag, resource limits, count), and if it looks
> reasonable, register it."

Tools used: `register_job` (the `jobHcl` argument handles the HCL→JSON parse
step itself via `/v1/jobs/parse`), `get_job` (to diff against beforehand).

### Node capacity check before deploying

> "Before I register a new job that needs 2 CPU / 4GB per allocation, check
> if any node has that much free capacity. Warn me if not."

Tools used: `list_nodes`, `get_node` (for the resource/allocation breakdown
per node).

## Why an agent instead of a script for this?

Every recipe above is scriptable with the raw Nomad API directly — the value
of routing it through an MCP-connected agent is:

- **Judgment calls** ("does this look like a transient failure?", "is this
  scale change reasonable?") that a fixed script can't make.
- **Natural-language audit trail** — the headless log shows *why* it acted,
  not just that it called an endpoint.
- **One tool, many ad-hoc tasks** — you don't write a new script for every
  variation; you change the prompt.

If a task is truly fixed and deterministic (e.g. "always restart job X every
night at 2am, no judgment involved"), a plain cron job calling the Nomad API
directly is simpler and cheaper than involving an LLM at all. Reach for
nomad-mcp when the task benefits from reasoning over cluster state, not for
pure repetition.
