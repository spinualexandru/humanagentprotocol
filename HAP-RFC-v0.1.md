# HAP — Human-Agent Protocol

> A universal protocol for symbiotic collaboration between humans and autonomous systems.

| | |
|---|---|
| **Version** | 0.1 (Revised Draft) |
| **Status** | Proposal / MVP |
| **License** | Spec under CC BY 4.0; Reference Runtime under Apache-2.0 |
| **Target Timeline** | 6 weeks |

---

## 0. Executive Summary

HAP enables autonomous agents to request human decisions in a structured, auditable, and latency-safe manner. Humans become first-class runtime nodes with machine-readable approvals, cryptographic signatures, and replay protection.

**Core Innovation:** Agents never block waiting for humans. Instead, they create tickets with defined timeout behaviors, allowing graceful degradation or escalation.

**This Document:** Defines a minimal viable protocol and reference implementation achievable in 6 weeks.

---

## 1. Goals & Non-Goals

### Goals (MVP)

- **Latency-safe by design:** Agents emit tickets and subscribe to resolution events; never block.
- **Auditability:** Append-only event log with human approvals bound to specific artifacts.
- **Security:** Cryptographically signed intents; WebAuthn-based approvals.
- **Simplicity:** Minimal protocol surface; easy to implement adapters.
- **Local-first:** Works without external dependencies; privacy by default.

### Non-Goals (MVP)

- AI-powered Membrane: No automatic grouping, digests, or smart throttling (deferred to v0.2).
- Complex policy engines: No Cedar/OPA integration (simple JSON rules only).
- Multi-approver quorum: Single approver per ticket only.
- Business hours / SLA tracking: Wall-clock timeouts only.
- Distributed consensus: Single-node runtime; no multi-region sync.
- Mobile apps / Slack: CLI and Tauri desktop app only.
- Merkle audit chains: Simple append-only log with checksums.

### Post-MVP (v0.2+)

- Intelligent Membrane (batching, auto-rules, risk inference)
- Multi-approver workflows with quorum
- Business hours and SLA tracking
- Cognitive Contract with progressive profiling
- WebAuthn cryptographic signing for approvals
- WebSocket server for multi-client real-time updates
- VSCode extension adapter
- GitHub/Slack/mobile adapters
- Tamper-evident Merkle chains
- QUIC transport and Protobuf envelope

---

## 2. Core Concepts

### Ticket

A human-addressed request with a defined lifecycle. Contains:

- **Intent:** What the agent wants to do (e.g., `modify_file`, `deploy`, `approve_expense`)
- **Artifact binding:** Immutable reference to the thing being approved (file hash, commit SHA, etc.)
- **Lease:** Timeout duration and behavior (`auto_approve`, `auto_reject`, `cancel`)
- **Risk score:** 0.0-1.0 computed from change scope and context

### Lease

A timer contract attached to a ticket:

- **TTL (Time To Live):** Wall-clock seconds until expiry
- **On Timeout:** Action to take if human doesn't respond (`auto_approve` | `auto_reject` | `cancel`)
- **Pause Behavior:** Timer pauses when ticket is `ACKED` (human has seen it but not decided)

### Event Log

Append-only stream of all HAP events. Each event has:

- Unique ID, timestamp, type, payload
- SHA-256 checksum of `(prev_checksum || current_payload)`
- No deletion or modification; only appends

### Signed Intent

A human's decision, cryptographically bound to:

- Specific ticket ID
- Artifact hash (e.g., Git diff SHA-256)
- Expiry timestamp (30-60 seconds for high-risk actions)
- WebAuthn signature (device-bound credential)

---

## 3. Message Types (Wire-Level)

All messages are JSON objects. Each has `id`, `type`, `ts`. In the current MVP, these are stored as events in the SQLite event log rather than transmitted over WebSocket.

### 3.1. Ticket Creation

```json
{
  "id": "evt_01HX...",
  "type": "ticket.create",
  "ts": "2025-10-29T10:01:05Z",
  "ticket": {
    "id": "tk_9f3",
    "from": "agent:code_assist",
    "to": "human:alex",
    "intent": {
      "kind": "modify_file",
      "summary": "Refactor authentication middleware",
      "details": {
        "file": "src/auth/middleware.ts",
        "diff": "...",
        "lines_added": 12,
        "lines_removed": 5
      }
    },
    "artifact": {
      "type": "git_diff",
      "repo": "github.com/acme/app",
      "base_commit": "a1b2c3d4",
      "diff_hash": "sha256:e3f8a9b2..."
    },
    "lease": {
      "ttl_seconds": 3600,
      "on_timeout": "auto_reject"
    },
    "risk": 0.22,
    "priority": "normal",
    "created_at": "2025-10-29T10:01:05Z"
  }
}
```

**Field Specifications:**

- `intent.kind` - Enum of allowed actions (`modify_file`, `delete_file`, `run_command`, `deploy`, `approve_expense`, etc.)
- `artifact.diff_hash` - SHA-256 of the diff text after normalization (strip timestamps, sort hunks by line number)
- `risk` - Float 0.0-1.0 (see [section 5](#5-risk-scoring-baseline-algorithm) for calculation)
- `priority` - `low` | `normal` | `high` | `critical` (human UX hint; no automatic behavior)
- `lease.ttl_seconds` - Wall-clock countdown; pauses when state is `ACKED`
- `lease.on_timeout` - Must be one of: `auto_approve`, `auto_reject`, `cancel`

### 3.2. Ticket State Transitions

```json
{
  "id": "evt_01HY...",
  "type": "ticket.state_change",
  "ts": "2025-10-29T10:02:15Z",
  "ticket_id": "tk_9f3",
  "from_state": "PENDING",
  "to_state": "DELIVERED",
  "delivered_to": "human:alex",
  "metadata": {}
}
```

### 3.3. Human Acknowledgment (Pause Lease)

```json
{
  "id": "evt_01HZ...",
  "type": "ticket.ack",
  "ts": "2025-10-29T10:03:00Z",
  "ticket_id": "tk_9f3",
  "from": "human:alex",
  "note": "Reviewing now..."
}
```

**Effect:** Lease timer pauses. Human has seen the ticket and is actively reviewing.

### 3.4. Signed Intent (Approval/Rejection)

```json
{
  "id": "evt_01J0...",
  "type": "intent.sign",
  "ts": "2025-10-29T10:05:30Z",
  "intent": {
    "ticket_id": "tk_9f3",
    "from": "human:alex",
    "decision": "approve",
    "artifact_hash": "sha256:e3f8a9b2...",
    "expires_at": "2025-10-29T10:06:30Z",
    "nonce": "n_923f1a...",
    "signature": {
      "algorithm": "ES256",
      "value": "base64url_encoded_sig...",
      "credential_id": "base64url_encoded_credential..."
    },
    "comment": "LGTM, refactor looks solid"
  }
}
```

**Field Specifications:**

- `decision` - `approve` | `reject` | `request_changes`
- `artifact_hash` - MUST match the original ticket's `artifact.diff_hash`
- `expires_at` - Short expiry (30-60s for critical actions; 5min for low-risk)
- `nonce` - Random 128-bit value; single-use (stored in event log)
- `signature` - WebAuthn assertion signature over canonical JSON of `{ticket_id, decision, artifact_hash, expires_at, nonce}`

### 3.5. Ticket Timeout

```json
{
  "id": "evt_01J1...",
  "type": "ticket.timeout",
  "ts": "2025-10-29T11:01:05Z",
  "ticket_id": "tk_9f3",
  "action_taken": "auto_reject",
  "reason": "Lease expired after 3600 seconds"
}
```

### 3.6. Ticket Cancellation (Agent-Initiated)

```json
{
  "id": "evt_01J2...",
  "type": "ticket.cancel",
  "ts": "2025-10-29T10:10:00Z",
  "ticket_id": "tk_9f3",
  "from": "agent:code_assist",
  "reason": "Code changed; approval no longer relevant"
}
```

---

## 4. Ticket Lifecycle (Finite State Machine)

```
PENDING -> DELIVERED -> ACKED -> (APPROVED | REJECTED | CHANGES_REQUESTED)
  |          |         |
  +----------+---------+-------> CANCELED (from any non-terminal state)
                              |
                          EXPIRED (from PENDING or DELIVERED only)
```

> **Note:** Tickets are created directly in `PENDING` state. The `NEW` state from earlier drafts is not used in the current implementation.

### State Definitions

- **PENDING** - Ticket created and queued for delivery; lease timer not yet started
- **DELIVERED** - Presented to human inbox; lease timer running
- **ACKED** - Human has opened/seen the ticket; lease timer pauses
- **APPROVED** - Human approved via signed intent
- **REJECTED** - Human rejected via signed intent
- **CHANGES_REQUESTED** - Human requested modifications
- **EXPIRED** - Lease expired; `on_timeout` action executed
- **CANCELED** - Agent or system canceled the ticket

### Lease Timer Behavior

| State | Timer Status | Notes |
|-------|-------------|-------|
| PENDING | Not started | Ticket created; awaiting delivery |
| DELIVERED | Running | Human notified; countdown begins |
| ACKED | Paused | Human is actively reviewing |
| APPROVED/REJECTED | Stopped | Terminal state |
| EXPIRED | Stopped | Timeout reached |
| CANCELED | Stopped | Ticket invalidated |

### Timeout Actions

When a lease expires in `PENDING` or `DELIVERED` state:

- **`auto_approve`** - Ticket automatically transitions to `APPROVED` (system-generated intent with `from: system:timeout`)
- **`auto_reject`** - Ticket transitions to `REJECTED` (system-generated)
- **`cancel`** - Ticket transitions to `CANCELED`

> **Important:** Timeout CANNOT occur after `ACKED` because the timer is paused. Human must explicitly approve/reject or cancel.

---

## 5. Risk Scoring (Baseline Algorithm)

Risk is a float from 0.0 (safe) to 1.0 (dangerous), computed as:

```
risk = min(1.0, scope_factor * 0.4 + env_factor * 0.4 + confidence_penalty * 0.2)
```

### Scope Factor

Based on magnitude of change:

```python
def scope_factor(intent):
    if intent.kind == "modify_file":
        lines_changed = intent.details.lines_added + intent.details.lines_removed
        if lines_changed < 10:
            return 0.1
        elif lines_changed < 50:
            return 0.3
        elif lines_changed < 200:
            return 0.6
        else:
            return 0.9
    elif intent.kind == "delete_file":
        return 0.7
    elif intent.kind == "run_command":
        return 0.8
    elif intent.kind == "deploy":
        return 0.95
    else:
        return 0.5  # Unknown action types default to medium
```

### Environment Factor

Based on deployment context (if applicable):

```python
def env_factor(artifact):
    if "prod" in artifact.get("environment", ""):
        return 1.0
    elif "staging" in artifact.get("environment", ""):
        return 0.5
    elif "dev" in artifact.get("environment", ""):
        return 0.2
    else:
        return 0.3  # Default for non-deployment actions
```

### Confidence Penalty

If agent provides self-reported confidence (optional):

```python
def confidence_penalty(agent_confidence):
    # Lower confidence = higher penalty
    if agent_confidence is None:
        return 0.5  # No confidence info = moderate penalty
    else:
        return 1.0 - agent_confidence  # Invert: 0.9 confidence -> 0.1 penalty
```

### Example Calculations

```python
# Small refactor in dev environment, high confidence
risk = 0.1 * 0.4 + 0.2 * 0.4 + (1 - 0.9) * 0.2
     = 0.04 + 0.08 + 0.02
     = 0.14  # Low risk

# Large deploy to prod, medium confidence
risk = 0.95 * 0.4 + 1.0 * 0.4 + (1 - 0.6) * 0.2
     = 0.38 + 0.40 + 0.08
     = 0.86  # High risk

# Delete file in staging, no confidence info
risk = 0.7 * 0.4 + 0.5 * 0.4 + 0.5 * 0.2
     = 0.28 + 0.20 + 0.10
     = 0.58  # Medium-high risk
```

> **Note:** This is a baseline heuristic. Projects should tune weights and thresholds based on their risk tolerance.

---

## 6. Security Model

### 6.1. Identity

**Humans:**

- OIDC login (Google, GitHub, Okta, etc.)
- WebAuthn passkey for device-bound credentials
- No passwords; only biometric/hardware keys

**Agents:**

- API key (MVP: simple bearer tokens)
- Post-MVP: SPIFFE/SVID or mTLS with client certificates

### 6.2. Signed Intent Verification

Runtime verifies:

1. **Signature validity:** WebAuthn assertion signature matches public key
2. **Artifact binding:** `intent.artifact_hash` matches `ticket.artifact.diff_hash`
3. **Expiry:** `intent.expires_at` is in the future but not too far (max 5 minutes)
4. **Nonce uniqueness:** `intent.nonce` hasn't been used before (check event log)
5. **Ticket state:** Ticket is in `ACKED` or `DELIVERED` state (not already resolved)

If any check fails, the intent is rejected and logged as `intent.invalid`.

### 6.3. Replay Protection

- **Nonces:** Each intent includes a random 128-bit nonce; stored in event log to prevent reuse
- **Short expiry:** High-risk intents expire in 30-60 seconds
- **Artifact pinning:** Intent is bound to exact diff hash; any change invalidates approval
- **Single-use:** Once an intent is applied, the ticket transitions to terminal state

### 6.4. Step-Up Authentication

For `risk >= 0.7`, the UI prompts for explicit WebAuthn user verification:

1. Show human-readable summary: _"You are approving deployment to production affecting 47 files."_
2. Require typed confirmation: _"Type 'approve production' to continue"_
3. Request WebAuthn with `userVerification: required` (biometric or PIN)

### 6.5. Transport Security

- WebSocket over TLS 1.3 (`wss://`)
- Certificate pinning for production deployments
- Agent API keys transmitted in `Authorization: Bearer <token>` header

### 6.6. Event Log Integrity (MVP)

```python
def compute_event_hash(event, prev_hash):
    canonical = json.dumps(event, sort_keys=True, separators=(',', ':'))
    data = f"{prev_hash}||{canonical}".encode('utf-8')
    return hashlib.sha256(data).hexdigest()
```

Each event stores `prev_hash` and `hash`. On startup, runtime verifies chain integrity:

```python
def verify_log_integrity(events):
    prev = "0" * 64  # Genesis hash
    for event in events:
        expected = compute_event_hash(event.payload, prev)
        if event.hash != expected:
            raise IntegrityError(f"Event {event.id} hash mismatch")
        prev = event.hash
```

Post-MVP: Add periodic Merkle tree checkpoints and external anchoring.

---

## 7. Reference Runtime Architecture

### 7.1. Repository Structure

```
/
  /packages/
    /shared/                # Zod schemas, TS types, protocol constants
      src/
        constants.ts        # TICKET_STATES, PRIORITIES, TIMEOUT_ACTIONS, etc.
        schemas.ts          # Zod validation schemas
        types.ts            # TypeScript interfaces (Ticket, HapEvent, etc.)
    /core/                  # FSM engine, SQLite persistence, event log
      src/
        engine.ts           # HapEngine: high-level API combining all services
        events.ts           # EventLog: append-only with SHA-256 hash chain
        tickets.ts          # TicketService: ticket lifecycle FSM
        leases.ts           # LeaseManager: timer management (pause/resume)
        storage.ts          # Storage: SQLite adapter (better-sqlite3)
        migrate.ts          # Schema migration (tickets, events, used_nonces, config)
    /sdk/                   # Client library (stub, planned for future)
    /mcp-server/            # MCP stdio bridge for AI agent tools
      src/
        index.ts            # MCP server entry point
        tools.ts            # 6 tools (create, list, get, approve, reject, ack)
        resources.ts        # 3 resources (pending-tickets, all-tickets, event-log)
    /cli/                   # Human-facing CLI
      src/
        index.ts            # Commands: inbox, show, approve, reject, ack, events, verify
        hook.ts             # Claude Code PreToolUse hook for auto-ticket creation
    /tauri-app/             # Desktop approval UI (Tauri v2 + Rust)
      src-tauri/            # Rust backend (reads SQLite directly via rusqlite)
  /docs/
  package.json              # npm workspaces root
  tsconfig.json
  vitest.config.ts
  README.md
  CLAUDE.md
  .mcp.json                 # MCP server configuration
```

> **Note:** The Tauri app is a separate workspace (not in npm workspaces) and has its own Cargo/npm dependencies. All other packages share a single SQLite database (`~/.hap/hap.db`, override with `HAP_DB_PATH`).

### 7.2. Data Models (SQLite Schema)

The implementation uses `better-sqlite3` with WAL mode and foreign keys enabled. Schema is auto-migrated on `Storage` initialization.

```sql
CREATE TABLE tickets (
  id          TEXT PRIMARY KEY,
  "from"      TEXT NOT NULL,
  "to"        TEXT NOT NULL,
  intent      TEXT NOT NULL,          -- JSON
  artifact    TEXT,                   -- JSON (nullable)
  lease       TEXT NOT NULL,          -- JSON { ttl_seconds, on_timeout }
  risk        REAL NOT NULL,
  priority    TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'PENDING',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tickets_to_state ON tickets("to", state);
CREATE INDEX idx_tickets_state_created ON tickets(state, created_at);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  ts          TEXT NOT NULL,
  payload     TEXT NOT NULL,          -- JSON
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_ts ON events(ts);
CREATE INDEX idx_events_type ON events(type);

CREATE TABLE used_nonces (
  nonce       TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL,
  used_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_used_nonces_used_at ON used_nonces(used_at);

CREATE TABLE config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
```

> **Note:** Human and Agent identity tables (OIDC credentials, WebAuthn keys, API keys) are deferred to post-MVP. The current implementation identifies participants by string IDs (`human:alex`, `agent:code_assist`) without credential verification.

### 7.3. Core APIs

#### HapEngine (Core Library)

The `@hap/core` package exposes a `HapEngine` class that combines all services:

```typescript
import { HapEngine } from '@hap/core';

const engine = new HapEngine({ dbPath: '~/.hap/hap.db' });

// Create ticket (starts in PENDING state)
const ticket = engine.createTicket({
  to: 'human:alex',
  kind: 'modify_file',
  summary: 'Refactor authentication middleware',
  file: 'src/auth/middleware.ts',
  diff: diffText,
  lines_added: 12,
  lines_removed: 5,
  lease: { ttl_seconds: 3600, on_timeout: 'auto_reject' },
  // risk is auto-computed from lines changed if not provided
});

// Deliver, ack, approve/reject
engine.deliver(ticket.id);
engine.ack(ticket.id, 'Reviewing now...');
engine.approve(ticket.id, 'LGTM');
engine.reject(ticket.id, 'Needs tests');
```

#### MCP Server (Agent Interface)

Agents interact with HAP via the `@hap/mcp-server` package, which exposes an MCP stdio bridge with 6 tools and 3 resources:

**Tools:**

| Tool | Description |
|------|-------------|
| `hap_create_ticket` | Create a new approval ticket |
| `hap_list_pending` | List pending tickets for a human |
| `hap_get_ticket` | Get ticket details by ID |
| `hap_approve_ticket` | Approve a ticket (with step-up confirmation for high-risk) |
| `hap_reject_ticket` | Reject a ticket with optional comment |
| `hap_ack_ticket` | Acknowledge a ticket (pauses lease timer) |

**Resources:**

| Resource | Description |
|----------|-------------|
| `pending-tickets` | List of pending tickets |
| `all-tickets` | List of all tickets |
| `event-log` | Full event log |

> **Note:** The `@hap/sdk` package is a stub reserved for a future programmatic TypeScript client. The MCP server is the primary agent integration point for MVP.

#### Human SDK (Planned)

WebSocket-based human client SDK with WebAuthn signing is deferred to post-MVP. Humans currently interact via the CLI or Tauri desktop app.

### 7.4. Transport Protocol

#### MCP stdio (Current Implementation)

The MVP uses [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) over stdio as the agent transport. This is simpler than WebSocket and integrates directly with Claude Code and other MCP-compatible AI tools.

Configuration (`.mcp.json`):

```json
{
  "mcpServers": {
    "hap": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/index.ts"]
    }
  }
}
```

All components share a single SQLite database (`~/.hap/hap.db`), so the CLI and Tauri app can read ticket state directly without a separate server process.

#### WebSocket Protocol (Planned for Post-MVP)

A WebSocket server with subscription semantics and heartbeats is planned for multi-client and remote deployment scenarios. This would enable real-time push notifications to human UIs and event streaming to agent subscribers.

---

## 8. CLI Inbox (Human Interface)

The CLI runs via `tsx` (no build step needed). All commands operate on the shared SQLite database.

### 8.1. Commands

```bash
# List pending tickets
$ npx tsx packages/cli/src/index.ts inbox
# or: hap inbox / hap list
```

```
+----------+----------+------------------------------+----------+----------+
| ID       | Priority | Summary                      | Risk     | Age      |
+----------+----------+------------------------------+----------+----------+
| tk_9f3   | normal   | Refactor auth middleware      | 0.22     | 5m       |
| tk_a1b   | high     | Deploy to staging             | 0.68     | 12m      |
| tk_c4d   | low      | Fix typo in README            | 0.05     | 1h       |
+----------+----------+------------------------------+----------+----------+
```

```bash
# Show ticket details
$ hap show tk_9f3
```

```
Ticket: tk_9f3
From: agent:code_assist
Priority: normal
Risk: 0.22 (low)
Created: 2025-10-29 10:01:05 (5 minutes ago)
Lease: Expires in 55 minutes (auto_reject on timeout)

Intent: modify_file
File: src/auth/middleware.ts
Changes: +12 -5 lines
```

```bash
# Acknowledge (pause timer)
$ hap ack tk_9f3 "Reviewing now..."
# => Ticket acknowledged. Lease timer paused.

# Approve
$ hap approve tk_9f3 "LGTM"
# => Ticket approved!

# Reject
$ hap reject tk_9f3 "Please add unit tests first"
# => Ticket rejected with comment.

# Show event log
$ hap events
# => JSON event log output

# Verify event log integrity (hash chain)
$ hap verify
# => Event log integrity: OK (N events verified)
```

### 8.2. Claude Code Hook

The CLI includes a hook (`packages/cli/src/hook.ts`) that integrates with Claude Code's `PreToolUse` hook system. It auto-approves read-only tools (Read, Glob, Grep, etc.) and creates HAP tickets for write/execute tools, polling for human approval at 400ms intervals with a 5-minute default TTL.

> **Note:** WebAuthn-based signing for CLI approvals is deferred to post-MVP. Currently approvals are recorded directly in the event log without cryptographic signatures.

---

## 9. Desktop App (Human UI)

The human approval UI is implemented as a Tauri v2 desktop application (`packages/tauri-app/`), replacing the originally planned VSCode extension. The Tauri app reads the shared SQLite database directly via `rusqlite` on the Rust backend.

### 9.1. Features (Planned)

- **Ticket Inbox:** Shows pending tickets grouped by priority
- **Diff Viewer:** Inline diff with syntax highlighting
- **Approve/Reject:** Action buttons for ticket resolution
- **Notifications:** System notifications for new high-priority tickets
- **Risk Indicator:** Color-coded badge (green < 0.3, yellow 0.3-0.7, red > 0.7)

### 9.2. UI Mockup

```
+---------------------------------------------+
| HAP Inbox                                   |
+---------------------------------------------+
| * High Priority (1)                         |
|   tk_a1b - Deploy to staging - 12m          |
|   Risk: 0.68                                |
|                                             |
| * Normal (1)                                |
|   tk_9f3 - Refactor auth middleware - 5m    |
|   Risk: 0.22                                |
|                                             |
| * Low (1)                                   |
|   tk_c4d - Fix typo in README - 1h          |
|   Risk: 0.05                                |
+---------------------------------------------+

[User clicks tk_9f3]

+---------------------------------------------+
| Ticket: tk_9f3                              |
| Refactor authentication middleware          |
|                                             |
| From: agent:code_assist                     |
| Risk: 0.22 (low)                            |
| Lease: 55m remaining (auto_reject)          |
|                                             |
| [View Diff] [Approve] [Reject] [Req Change] |
+---------------------------------------------+
```

### 9.3. Architecture

The Tauri app is a separate workspace (not part of npm workspaces) with its own Cargo and npm dependencies:

```bash
cd packages/tauri-app && npm install && cargo tauri dev
```

> **Note:** A VSCode extension adapter is planned for post-MVP as a community contribution.

---

## 10. Example Flow: File Modification Approval

### 10.1. Agent Code

```typescript
// agent.ts - AI coding assistant using HapEngine directly
import { HapEngine } from '@hap/core';
import { generateRefactoring } from './utils';

const engine = new HapEngine({ dbPath: process.env.HAP_DB_PATH });

async function proposeRefactoring(file: string) {
  // Generate refactoring
  const { original, refactored, diff } = await generateRefactoring(file);

  // Compute risk
  const linesChanged = diff.additions + diff.deletions;
  const risk = Math.min(1.0, linesChanged / 100 * 0.4 + 0.1);

  // Create ticket (starts in PENDING state, risk auto-computed)
  const ticket = engine.createTicket({
    to: 'human:alex',
    kind: 'modify_file',
    summary: `Refactor ${file}`,
    file: file,
    diff: diff.text,
    lines_added: diff.additions,
    lines_removed: diff.deletions,
    lease: {
      ttl_seconds: 3600,  // 1 hour
      on_timeout: 'auto_reject'
    }
  });

  console.log(`Ticket created: ${ticket.id}`);

  // Poll for approval (or use MCP tool hap_get_ticket)
  const poll = setInterval(() => {
    const t = engine.getTicket(ticket.id);
    if (t.state === 'APPROVED') {
      clearInterval(poll);
      console.log('Approved! Applying changes...');
      applyDiff(file, diff.text);
    } else if (t.state === 'REJECTED' || t.state === 'EXPIRED' || t.state === 'CANCELED') {
      clearInterval(poll);
      console.log(`Ticket ${t.state.toLowerCase()}`);
    }
  }, 1000);
}
```

### 10.2. Human Workflow

1. Agent creates ticket -> `ticket.create` event
2. Runtime delivers ticket -> `ticket.state_change` to `DELIVERED`
3. Human opens VSCode inbox -> sees new ticket with `risk=0.22` (green)
4. Human clicks ticket -> views diff in editor
5. Human clicks "Acknowledge" -> lease timer pauses
6. Human reviews code -> checks logic, tests, style
7. Human clicks "Approve" -> VSCode triggers WebAuthn
8. Security key tap -> generates signed intent with 60s expiry
9. Runtime verifies intent -> checks signature, nonce, artifact hash
10. Ticket approved -> `ticket.state_change` to `APPROVED`
11. Agent receives event -> applies diff to file

### 10.3. Timeline

```
T+0s      Agent creates ticket (state: PENDING)
T+0.1s    Runtime delivers to human:alex (state: DELIVERED, lease starts)
T+120s    Human opens ticket in VSCode
T+125s    Human clicks "Acknowledge" (state: ACKED, lease pauses)
T+180s    Human reviews diff (30s reading time)
T+210s    Human clicks "Approve" -> WebAuthn ceremony
T+212s    Signed intent submitted to runtime
T+212.1s  Runtime verifies signature
T+212.2s  Runtime checks artifact hash
T+212.3s  Runtime checks nonce uniqueness
T+212.4s  Ticket state -> APPROVED
T+212.5s  Agent receives event -> applies diff
```

---

## 11. Testing Strategy

### 11.1. Unit Tests

```typescript
// tickets.test.ts
describe('Ticket FSM', () => {
  it('should transition from PENDING to DELIVERED', () => {
    const ticket = createTicket({ to: 'human:alex' });
    expect(ticket.state).toBe('PENDING');

    deliverTicket(ticket.id);
    expect(getTicket(ticket.id).state).toBe('DELIVERED');
  });

  it('should pause lease timer on ACK', () => {
    const ticket = createTicket({ lease: { ttl_seconds: 60 } });
    deliverTicket(ticket.id);

    // Wait 30 seconds
    advanceTime(30000);

    ackTicket(ticket.id);
    const lease = getTicket(ticket.id).lease;
    expect(lease.remaining_seconds).toBe(30);

    // Wait another 30 seconds (timer paused)
    advanceTime(30000);
    expect(lease.remaining_seconds).toBe(30);  // Still 30!
  });

  it('should auto-reject on timeout', async () => {
    const ticket = createTicket({
      lease: { ttl_seconds: 10, on_timeout: 'auto_reject' }
    });
    deliverTicket(ticket.id);

    advanceTime(11000);

    expect(getTicket(ticket.id).state).toBe('EXPIRED');
  });
});
```

### 11.2. Integration Tests

```typescript
// approval-flow.test.ts
describe('Approval Flow', () => {
  it('should complete full agent->human->agent cycle', async () => {
    const agent = createTestAgent();
    const human = createTestHuman();

    // Agent creates ticket
    const ticket = await agent.createTicket({
      to: human.id,
      intent: { kind: 'modify_file', details: { /* ... */ } },
      artifact: { diff_hash: 'abc123' },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' }
    });

    // Human approves
    const intent = await human.signIntent({
      ticketId: ticket.id,
      decision: 'approve',
      artifactHash: 'abc123'
    });

    // Verify ticket approved
    await waitFor(() =>
      expect(agent.getTicket(ticket.id).state).toBe('APPROVED')
    );
  });
});
```

### 11.3. Security Tests

```typescript
// security.test.ts
describe('Intent Verification', () => {
  it('should reject intent with wrong artifact hash', async () => {
    const ticket = createTicket({ artifact: { diff_hash: 'abc123' } });
    const intent = signIntent({
      ticketId: ticket.id,
      artifactHash: 'wrong_hash'  // Mismatch!
    });

    await expect(submitIntent(intent)).rejects.toThrow('Artifact hash mismatch');
  });

  it('should reject replayed nonce', async () => {
    const ticket = createTicket({ artifact: { diff_hash: 'abc123' } });
    const intent = signIntent({
      ticketId: ticket.id,
      nonce: 'nonce_123'
    });

    await submitIntent(intent);  // First use: OK
    await expect(submitIntent(intent)).rejects.toThrow('Nonce already used');
  });

  it('should reject expired intent', async () => {
    const ticket = createTicket({ artifact: { diff_hash: 'abc123' } });
    const intent = signIntent({
      ticketId: ticket.id,
      expiresAt: new Date(Date.now() - 1000)  // Expired 1s ago
    });

    await expect(submitIntent(intent)).rejects.toThrow('Intent expired');
  });
});
```

### 11.4. Load Tests

```typescript
// load.test.ts
describe('Load Testing', () => {
  it('should handle 100 concurrent tickets', async () => {
    const agent = createTestAgent();
    const tickets = await Promise.all(
      Array(100).fill(0).map(() =>
        agent.createTicket({ to: 'human:alex', /* ... */ })
      )
    );

    expect(tickets).toHaveLength(100);
    tickets.forEach(t => expect(t.state).toBe('PENDING'));
  });

  it('should maintain event log integrity under load', async () => {
    // Create 1000 events rapidly
    for (let i = 0; i < 1000; i++) {
      await createTicket({ /* ... */ });
    }

    // Verify chain
    const valid = await verifyEventLogIntegrity();
    expect(valid).toBe(true);
  });
});
```

---

## 12. Error Handling

### 12.1. Network Failures

**Problem:** WebSocket disconnects mid-approval

**Solution:**

```typescript
class HAPClient {
  private reconnect() {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.on('open', () => {
      // Resubscribe to pending tickets
      this.tickets.resubscribe();
    });
  }
}
```

**Guarantees:**

- All events stored in append-only log
- Clients can replay from last seen event ID
- Idempotent ticket creation (client-generated IDs)

### 12.2. Corrupt Event Log

**Detection:**

```typescript
function verifyEventLogIntegrity(events: Event[]): boolean {
  let prevHash = "0".repeat(64);
  for (const event of events) {
    const expected = computeEventHash(event.payload, prevHash);
    if (event.hash !== expected) {
      console.error(`Integrity violation at event ${event.id}`);
      return false;
    }
    prevHash = event.hash;
  }
  return true;
}
```

**Recovery:**

- Stop runtime immediately
- Alert administrators
- Restore from backup
- Investigate tampering source

### 12.3. Agent Crash During Ticket Lifecycle

**Problem:** Agent creates ticket, then crashes before handling approval

**Solution:** Ticket remains in `APPROVED` state in event log. Agent can query all approved tickets on restart.

### 12.4. Human Approves Stale Artifact

**Problem:** Human approves diff, but code changed (rebase) before agent applies

**Solution:** Agent must re-verify artifact hash before applying.

---

## 13. Monitoring & Observability

### 13.1. Metrics (Prometheus)

```promql
// Ticket lifecycle metrics
hap_tickets_created_total{priority="normal",risk_bucket="low"}
hap_tickets_approved_total{priority="high"}
hap_tickets_rejected_total{reason="changes_requested"}
hap_tickets_expired_total{on_timeout="auto_reject"}

// Latency metrics
hap_ticket_approval_duration_seconds{priority="normal",p50=120,p95=300,p99=600}
hap_lease_remaining_seconds{ticket_id="tk_9f3"}

// Security metrics
hap_intents_verified_total
hap_intents_rejected_total{reason="nonce_reuse"}
hap_webauthn_ceremonies_total{success="true"}
```

### 13.2. Traces (OpenTelemetry)

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('hap-runtime');

async function createTicket(req: TicketCreateRequest) {
  const span = tracer.startSpan('ticket.create', {
    attributes: {
      'ticket.to': req.to,
      'ticket.priority': req.priority,
      'ticket.risk': req.risk
    }
  });

  try {
    const ticket = await ticketService.create(req);
    span.setStatus({ code: SpanStatusCode.OK });
    return ticket;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
```

### 13.3. Logs (Structured JSON)

```json
{
  "level": "info",
  "ts": "2025-10-29T10:01:05.123Z",
  "msg": "Ticket created",
  "ticket_id": "tk_9f3",
  "from": "agent:code_assist",
  "to": "human:alex",
  "risk": 0.22,
  "priority": "normal",
  "trace_id": "abc123...",
  "span_id": "def456..."
}
```

### 13.4. Dashboards

Key metrics to track:

- **Approval latency:** p50, p95, p99 by priority
- **Timeout rate:** % of tickets expired vs. resolved
- **Risk distribution:** histogram of ticket risk scores
- **Human load:** tickets/hour per human
- **Security events:** nonce reuse, signature failures, expired intents

---

## 14. Deployment Guide

### 14.1. Local Development

```bash
# Clone repository
git clone https://github.com/spinualexandru/human-agent-protocol.git
cd human-agent-protocol

# Install all workspace dependencies
npm install

# Run tests
npm test

# Use CLI (runs via tsx, no build step needed)
npx tsx packages/cli/src/index.ts inbox
npx tsx packages/cli/src/index.ts approve tk_abc123 "LGTM"

# Tauri desktop app (separate workspace)
cd packages/tauri-app && npm install && cargo tauri dev
```

The SQLite database is auto-created at `~/.hap/hap.db` on first use (override with `HAP_DB_PATH` environment variable). Schema migrations run automatically.

### 14.2. MCP Integration

Add HAP as an MCP server in your `.mcp.json`:

```json
{
  "mcpServers": {
    "hap": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/index.ts"]
    }
  }
}
```

This makes HAP tools available to Claude Code and other MCP-compatible AI tools.

### 14.3. Production Deployment

> **Note:** Docker and Kubernetes deployment configurations are planned for post-MVP. The current architecture is local-first with a single SQLite database, suitable for single-developer or small-team use. Multi-node deployment will require a WebSocket server and shared database (PostgreSQL), which are planned for v0.2.

---

## 15. Migration from Existing Systems

### 15.1. GitHub PR Reviews -> HAP

```typescript
// Adapter: Convert GitHub PR to HAP ticket
import { Octokit } from '@octokit/rest';
import { HapEngine } from '@hap/core';

const github = new Octokit({ auth: process.env.GITHUB_TOKEN });
const engine = new HapEngine({ dbPath: process.env.HAP_DB_PATH });

github.webhooks.on('pull_request.opened', async ({ payload }) => {
  const pr = payload.pull_request;

  const ticket = engine.createTicket({
    to: `human:${pr.requested_reviewers[0].login}`,
    kind: 'modify_file',
    summary: pr.title,
    lines_added: pr.additions,
    lines_removed: pr.deletions,
    lease: {
      ttl_seconds: 86400,  // 24 hours
      on_timeout: 'cancel'
    }
  });

  // Link ticket to PR
  await github.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: pr.number,
    body: `HAP Ticket: ${ticket.id}`
  });
});
```

---

## 16. Roadmap
TBD

---

## 17. Open Questions (To Resolve Before v0.2)

### 17.1. Business Hours Handling

**Question:** How do we handle multi-timezone teams with complex schedules (holidays, PTO, oncall)?

**Options:**

- **A)** Integrate with Google Calendar / Outlook
- **B)** Use IANA timezone database + manual holiday config
- **C)** Defer to v0.3; use wall-clock TTLs for now

**Decision:** Start with (C), add (B) in v0.2, explore (A) for v0.3.

### 17.2. Escalation Chains

**Question:** What happens when escalation target is also unavailable?

**Options:**

- **A)** Max escalation depth (e.g., 3 levels), then auto-cancel
- **B)** Broadcast to entire team after N failed escalations
- **C)** Alert oncall rotation system

**Decision:** Implement (A) for MVP with configurable max depth.

### 17.3. Risk Taxonomy

**Question:** Should we standardize risk categories like CWE for vulnerabilities?

**Options:**

- **A)** Create HAP Risk Taxonomy (HRT) with categories like `data_leak`, `availability_impact`, `auth_bypass`
- **B)** Use existing standards (OWASP, MITRE ATT&CK)
- **C)** Keep risk as simple float; let projects define their own categories

**Decision:** Start with (C) for MVP; explore (A) for v0.2 based on community feedback.

### 17.4. Multi-Approver Conflicts

**Question:** If 2 of 3 approvers say yes, then code changes (rebase), do approvals auto-invalidate?

**Options:**

- **A)** Yes, always invalidate on artifact change
- **B)** Only invalidate if diff has "substantial" changes (need heuristic)
- **C)** Let human policy decide (configurable per ticket)

**Decision:** Defer multi-approver to v0.2; implement (A) for single-approver tickets in MVP.

---

## 18. Security Considerations

### 18.1. Threat Model

**Assumed Attacker Capabilities:**

- Network eavesdropping (TLS mitigates)
- Compromised agent API key
- Stolen human OIDC token (short-lived)
- Physical access to human's device (WebAuthn mitigates)

**Out of Scope (MVP):**

- Runtime server compromise (assume trusted)
- Zero-day in WebAuthn implementation
- Social engineering of humans

### 18.2. Mitigations

| Threat | Mitigation |
|--------|-----------|
| Replay attack | Nonces + short expiry + artifact pinning |
| Man-in-the-middle | TLS 1.3 + certificate pinning |
| Stolen API key | Rotate keys frequently + monitor for abuse |
| Approval of wrong artifact | Cryptographic binding to diff hash |
| Compromised agent | API key revocation + audit log investigation |
| Human coercion | Step-up auth for high-risk actions |


---

## 19. Compliance & Legal

### 19.1. GDPR Considerations

**Personal Data Stored:**

- Human email, name (from OIDC)
- WebAuthn credential IDs (device identifiers)
- Ticket metadata (file paths, commit messages)

**Rights Implementation:**

- **Right to access:** `hap export-data --human-id=human:alex`
- **Right to deletion:** `hap delete-human --human-id=human:alex` (anonymizes event log entries)
- **Right to portability:** JSON export of all tickets and intents

### 19.2. SOC2 Readiness

**Type II Controls:**

- Append-only audit log (detective)
- Cryptographic signatures (preventive)
- Role-based access control (preventive)
- Monitoring and alerting (detective)

### 19.3. License

- **Protocol Specification:** CC BY 4.0 (attribution required, commercial use allowed)
- **Reference Runtime:** Apache 2.0 (permissive, compatible with commercial use)

---

## 20. Community & Governance

### 20.1. RFC Process (Post-MVP)

1. Draft RFC as GitHub issue with `[RFC]` prefix
2. Community discussion (2 weeks)
3. Address feedback and revise
4. Core team approval (simple majority)
5. Merge into spec repository
6. Implement in reference runtime

### 20.2. Backwards Compatibility

**Versioning:** Semantic versioning (`MAJOR.MINOR.PATCH`)

- **MAJOR:** Breaking wire protocol changes (e.g., removing message fields)
- **MINOR:** Additive changes (e.g., new message types, optional fields)
- **PATCH:** Bug fixes, documentation

**Compatibility Promise:**

- `v0.x` - No compatibility guarantees (experimental)
- `v1.x` - Backwards compatible within major version
- Clients MUST ignore unknown fields (forward compatibility)

### 20.3. Reference Implementations

**Planned:**

- TypeScript (reference, this spec)
- Python (community-maintained)
- Go (community-maintained)
- Rust (community-maintained)

**Adapters:**

- Tauri desktop app (reference)
- Claude Code hook (reference)
- MCP server (reference)
- VSCode (planned)
- GitHub Actions (planned)
- Neovim (community)
- Emacs (community)
- JetBrains IDEs (community)
- Slack (community)
- Discord (community)

---

## 21. Appendix A: JSON Schemas

### 21.1. Ticket Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://hap-protocol.org/schemas/ticket.json",
  "title": "Ticket",
  "type": "object",
  "required": ["id", "from", "to", "intent", "lease", "risk", "priority", "created_at"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^tk_[a-z0-9]{8,}$"
    },
    "from": {
      "type": "string",
      "pattern": "^(agent|system):[a-z0-9_-]+$"
    },
    "to": {
      "type": "string",
      "pattern": "^human:[a-z0-9_-]+$"
    },
    "intent": {
      "type": "object",
      "required": ["kind", "summary", "details"],
      "properties": {
        "kind": {
          "type": "string",
          "enum": ["modify_file", "delete_file", "create_file", "run_command", "deploy", "approve_expense"]
        },
        "summary": {
          "type": "string",
          "maxLength": 200
        },
        "details": {
          "type": "object"
        }
      }
    },
    "artifact": {
      "type": ["object", "null"],
      "required": ["type", "diff_hash"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["git_diff", "file_content", "command_script"]
        },
        "diff_hash": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        }
      }
    },
    "lease": {
      "type": "object",
      "required": ["ttl_seconds", "on_timeout"],
      "properties": {
        "ttl_seconds": {
          "type": "integer",
          "minimum": 1,
          "maximum": 604800
        },
        "on_timeout": {
          "type": "string",
          "enum": ["auto_approve", "auto_reject", "cancel"]
        }
      }
    },
    "risk": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0
    },
    "priority": {
      "type": "string",
      "enum": ["low", "normal", "high", "critical"]
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

### 21.2. Signed Intent Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://hap-protocol.org/schemas/intent.json",
  "title": "SignedIntent",
  "type": "object",
  "required": ["ticket_id", "from", "decision", "artifact_hash", "expires_at", "nonce", "signature"],
  "properties": {
    "ticket_id": {
      "type": "string",
      "pattern": "^tk_[a-z0-9]{8,}$"
    },
    "from": {
      "type": "string",
      "pattern": "^human:[a-z0-9_-]+$"
    },
    "decision": {
      "type": "string",
      "enum": ["approve", "reject", "request_changes"]
    },
    "artifact_hash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "expires_at": {
      "type": "string",
      "format": "date-time"
    },
    "nonce": {
      "type": "string",
      "pattern": "^n_[a-z0-9]{16,}$"
    },
    "signature": {
      "type": "object",
      "required": ["algorithm", "value", "credential_id"],
      "properties": {
        "algorithm": {
          "type": "string",
          "enum": ["ES256", "ES384", "ES512", "RS256"]
        },
        "value": {
          "type": "string",
          "contentEncoding": "base64url"
        },
        "credential_id": {
          "type": "string",
          "contentEncoding": "base64url"
        }
      }
    },
    "comment": {
      "type": "string",
      "maxLength": 1000
    }
  }
}
```

---

## 22. Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Ticket** | A request from an agent to a human for approval/review |
| **Lease** | A timeout contract specifying TTL and behavior on expiry |
| **Intent** | A human's signed decision (approve/reject) bound to an artifact |
| **Artifact** | The immutable thing being approved (file, diff, command, etc.) |
| **Risk Score** | A float 0.0-1.0 indicating danger level of the action |
| **FSM** | Finite State Machine - the ticket lifecycle state transitions |
| **Event Log** | Append-only stream of all HAP messages |
| **Nonce** | A random single-use value preventing replay attacks |
| **WebAuthn** | W3C standard for device-bound authentication (passkeys) |
| **Membrane** | (v0.2+) The intelligent batching/throttling layer for humans |
| **Cognitive Contract** | (v0.2+) A profile of human skills, roles, preferences |

---

## 23. Appendix C: Related Work

**Similar Protocols:**

- **Model Context Protocol (MCP):** IDE <-> LLM communication (Anthropic)
- **Agent Communication Protocol (ACP):** Agent-to-agent messaging
- **OpenAPI:** REST API specification

**Differences:**

- HAP is human-centric (not LLM-centric or agent-centric)
- HAP has built-in timeout/escalation semantics
- HAP mandates cryptographic approval signatures

**Inspiration:**

- **BPMN** (Business Process Model and Notation): Human task nodes in workflows
- **Camunda/Temporal:** Workflow engines with human tasks
- **GitHub PR Reviews:** Asynchronous approval flow with artifact binding

---

## 24. Conclusion

HAP provides a minimal, secure, and auditable protocol for human-agent collaboration. The current MVP implementation delivers:

- Core ticket lifecycle with FSM (PENDING through terminal states)
- Latency-safe lease semantics with pause/resume
- Append-only event log with SHA-256 hash chain integrity
- Simple risk scoring algorithm (auto-computed from change scope)
- MCP server for AI agent integration (6 tools, 3 resources)
- CLI inbox with Claude Code hook integration
- Tauri desktop app for visual approval workflow

Cryptographic signing (WebAuthn), WebSocket real-time transport, and a programmatic SDK are planned for post-MVP.

---

*End of Revised RFC v0.1*

For questions or contributions, contact: spinualexandru@outlook.com
