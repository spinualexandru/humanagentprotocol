# HAP — Human-Agent Protocol

A universal protocol for symbiotic collaboration between humans and autonomous AI agents.

HAP enables AI agents to request human decisions in a structured, auditable, and latency-safe manner. Agents never block — they create tickets with defined timeout behaviors, allowing graceful degradation or escalation.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  AI Agent    │────▶│  MCP Server  │────▶│  HAP Core       │
│  (Claude,    │     │  (stdio)     │     │  (SQLite + FSM) │
│   Codex,     │     └──────────────┘     └────────┬────────┘
│   Copilot)   │                                   │
└─────────────┘                          ┌─────────┴─────────┐
                                         │                   │
                                    ┌────┴────┐      ┌───────┴───────┐
                                    │  CLI    │      │  Tauri App    │
                                    │  (hap)  │      │  (Desktop UI) │
                                    └─────────┘      └───────────────┘
```

**Shared SQLite database** (`~/.hap/hap.db`) connects all components. The MCP server exposes HAP operations as tools that any AI agent can call. Humans approve/reject via CLI or desktop app.

## Quick Start

### 1. Install

```bash
git clone https://github.com/cortiq/hap.git
cd hap
npm install
```

### 2. Run Tests

```bash
npm test
```

### 3. Configure Your AI Tool

#### Claude Code

Already configured via `.mcp.json` in the project root. Or add globally:

```bash
claude mcp add --transport stdio hap-bridge -- npx tsx packages/mcp-server/src/index.ts
```

**Replace Claude's built-in approval system with HAP:**

Add a `PreToolUse` hook to your project's `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx /path/to/hap/packages/cli/src/hook.ts",
            "timeout": 310000
          }
        ]
      }
    ]
  }
}
```

Now every tool call (Bash, Edit, Write, etc.) creates a HAP ticket instead of showing Claude's standard permission prompt. Read-only tools (Read, Glob, Grep) are auto-approved. Write/execute tools block until you approve:

```
[HAP] Ticket tk_a1b2c3 created — Run command: npm test
[HAP] Approve: hap approve tk_a1b2c3 | Reject: hap reject tk_a1b2c3
```

Approve from another terminal or the Tauri app — Claude continues immediately.

Risk is scored per tool type:
| Tool | Risk | Priority |
|------|------|----------|
| `rm -rf`, `--force`, `reset --hard` | 0.95 | critical |
| `git push`, `docker`, `deploy` | 0.75 | high |
| `npm install`, `cargo build` | 0.40 | normal |
| Other Bash commands | 0.60 | normal |
| Write | 0.45 | normal |
| Edit | 0.35 | normal |
| Task (subagent) | 0.30 | low |

#### Codex CLI

```bash
# Add to your Codex MCP configuration
codex mcp add hap-bridge --stdio -- npx tsx /path/to/hap/packages/mcp-server/src/index.ts
```

#### OpenCode

Add to your OpenCode MCP config:

```json
{
  "mcpServers": {
    "hap-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/hap/packages/mcp-server/src/index.ts"],
      "env": { "HAP_HUMAN_ID": "human:yourname" }
    }
  }
}
```

#### VS Code Copilot

Add to `.vscode/mcp.json` or user settings:

```json
{
  "servers": {
    "hap-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/hap/packages/mcp-server/src/index.ts"],
      "env": { "HAP_HUMAN_ID": "human:yourname" }
    }
  }
}
```

#### Copilot CLI

Uses the same MCP configuration as VS Code Copilot.

### 4. Use the CLI

```bash
# List pending tickets
npx tsx packages/cli/src/index.ts inbox

# Show ticket details
npx tsx packages/cli/src/index.ts show tk_abc123

# Approve a ticket
npx tsx packages/cli/src/index.ts approve tk_abc123 "LGTM"

# Reject a ticket
npx tsx packages/cli/src/index.ts reject tk_abc123 "Needs tests"

# Acknowledge (pause timer)
npx tsx packages/cli/src/index.ts ack tk_abc123 "Reviewing..."

# Verify event log integrity
npx tsx packages/cli/src/index.ts verify
```

### 5. Build the Tauri Desktop App

```bash
cd packages/tauri-app
npm install
cargo tauri dev     # Development mode
cargo tauri build   # Production build
```

## MCP Tools

The MCP server exposes these tools to AI agents:

| Tool | Description |
|------|-------------|
| `hap_create_ticket` | Create a new approval ticket |
| `hap_list_pending` | List pending tickets |
| `hap_get_ticket` | Get ticket details by ID |
| `hap_approve_ticket` | Approve a ticket |
| `hap_reject_ticket` | Reject a ticket |
| `hap_ack_ticket` | Acknowledge a ticket (pause timer) |

## Ticket Lifecycle

```
PENDING → DELIVERED → ACKED → APPROVED / REJECTED / CHANGES_REQUESTED
    ↓          ↓         ↓
    └──────────┴─────────┴──→ CANCELED (from any non-terminal state)
                              EXPIRED  (from PENDING or DELIVERED on timeout)
```

- **Lease timer** starts at DELIVERED, pauses at ACKED
- **On timeout**: `auto_approve`, `auto_reject`, or `cancel`
- **Risk scoring**: 0.0-1.0 based on change scope, environment, and confidence
- **High-risk** (≥0.7): Requires step-up confirmation (`typed_confirmation="approve production"`)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HAP_DB_PATH` | `~/.hap/hap.db` | SQLite database path |
| `HAP_HUMAN_ID` | `human:alex` | Human identifier for the current user |

## Packages

| Package | Description |
|---------|-------------|
| `@hap/shared` | Zod schemas, TypeScript types, protocol constants |
| `@hap/core` | Ticket FSM, event log, lease timer, SQLite storage |
| `@hap/mcp-server` | MCP stdio server exposing HAP tools |
| `@hap/cli` | CLI for human inbox and approval workflow |
| `@hap/tauri-app` | Tauri v2 desktop approval UI |

## Event Log

All operations produce an append-only event log with SHA-256 hash chaining for integrity verification:

```bash
npx tsx packages/cli/src/index.ts events   # View event log
npx tsx packages/cli/src/index.ts verify   # Verify integrity
```

## License

Protocol Specification: CC BY 4.0
Reference Runtime: Apache 2.0
