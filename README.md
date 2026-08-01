# nomad-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes a [HashiCorp Nomad](https://www.nomadproject.io/) cluster as tools for MCP-compatible AI agents — Claude Code, Claude Desktop, [OpenCode](https://opencode.ai), Cursor, etc. It speaks standard MCP over stdio, so any client that supports stdio MCP servers works out of the box.

## Tools

Read-only, always available:

- `list_jobs`, `get_job`, `get_job_allocations`, `get_job_deployments`, `get_job_evaluations`
- `get_allocation`, `get_allocation_logs`
- `list_nodes`, `get_node`
- `list_deployments`, `get_deployment`
- `list_namespaces`

Write tools, disabled by default (see [Write access](#write-access)):

- `stop_job` — stop a job, optionally purge it
- `scale_task_group` — set a task group's count
- `reschedule_allocation` — stop a single allocation so Nomad reschedules it as a new allocation (`POST /v1/allocation/:id/stop`)
- `restart_allocation` — restart task(s) in an allocation in place, same allocation ID (`POST /v1/client/allocation/:id/restart`)
- `register_job` — submit a job from HCL or JSON (create or update)

## Setup

Requires Node.js 18+.

```sh
npm install
cp .env.example .env   # then edit .env with your Nomad address/token
```

Or, if you use [pixi](https://pixi.sh) and don't want a system Node install:

```sh
pixi run install
```

## Configuration

Standard `nomad` CLI environment variables:

| Variable | Default | Description |
|---|---|---|
| `NOMAD_ADDR` | `http://127.0.0.1:4646` | Nomad HTTP API address |
| `NOMAD_TOKEN` | _(none)_ | ACL token, sent as `X-Nomad-Token` |
| `NOMAD_NAMESPACE` | _(none)_ | Default namespace applied when a tool call doesn't specify one |
| `NOMAD_SKIP_VERIFY` | `false` | Skip TLS certificate verification |
| `NOMAD_CACERT` | _(none)_ | Path to a CA bundle for a private/internal CA |

### Write access

Write tools are **off by default**. An agent connected to this server can only read cluster state until you explicitly opt in:

```sh
NOMAD_MCP_WRITE_MODE=on
```

To allow only specific write tools instead of all four:

```sh
NOMAD_MCP_WRITE_MODE=on
NOMAD_MCP_WRITE_TOOLS=stop_job,scale_task_group
```

## Using it with an MCP client

The server is started as `node /path/to/nomad-mcp/src/index.js`, with config passed via environment variables. Point any MCP client's stdio server config at that command.

**Claude Code:**

```sh
claude mcp add nomad node /path/to/nomad-mcp/src/index.js \
  --env NOMAD_ADDR=https://nomad.example.com \
  --env NOMAD_TOKEN=your-token
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nomad": {
      "command": "node",
      "args": ["/path/to/nomad-mcp/src/index.js"],
      "env": {
        "NOMAD_ADDR": "https://nomad.example.com",
        "NOMAD_TOKEN": "your-token"
      }
    }
  }
}
```

**OpenCode** (`opencode.json` / `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "nomad": {
      "type": "local",
      "command": ["node", "/path/to/nomad-mcp/src/index.js"],
      "environment": {
        "NOMAD_ADDR": "https://nomad.example.com",
        "NOMAD_TOKEN": "your-token"
      }
    }
  }
}
```

(Check OpenCode's current docs for the exact config key names if this has changed — the important part is that it runs the same stdio command with the same environment variables.)

## Security notes

- `NOMAD_TOKEN` grants whatever an ACL policy allows — scope it to a policy with only the access this server actually needs (read-only policy if you're not enabling write mode).
- Write mode lets a connected agent stop jobs, scale them, restart allocations, and submit new job specs. Only enable it for a token/environment you're comfortable an LLM acting autonomously could affect.
- `register_job` submits directly to `/v1/jobs` with no dry-run step — review what an agent intends to submit before asking it to call this tool against a production namespace.
