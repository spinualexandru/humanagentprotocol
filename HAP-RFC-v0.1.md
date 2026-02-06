HAP — Human–Agent Protocol
A universal protocol for symbiotic collaboration between humans and autonomous systems.
Version: 0.1 (Revised Draft) Status: Proposal / MVP License: Spec under CC BY 4.0; Reference Runtime under Apache-2.0 Target Timeline: 6 weeks
--------------------------------------------------------------------------------
0) Executive Summary
HAP enables autonomous agents to request human decisions in a structured, auditable, and latency-safe manner. Humans become first-class runtime nodes with machine-readable approvals, cryptographic signatures, and replay protection.
Core Innovation: Agents never block waiting for humans. Instead, they create tickets with defined timeout behaviors, allowing graceful degradation or escalation.
This Document: Defines a minimal viable protocol and reference implementation achievable in 6 weeks.
--------------------------------------------------------------------------------
1) Goals & Non-Goals
Goals (MVP)
• Latency-safe by design: Agents emit tickets and subscribe to resolution events; never block.
• Auditability: Append-only event log with human approvals bound to specific artifacts.
• Security: Cryptographically signed intents; WebAuthn-based approvals.
• Simplicity: Minimal protocol surface; easy to implement adapters.
• Local-first: Works without external dependencies; privacy by default.
Non-Goals (MVP)
• ❌ AI-powered Membrane: No automatic grouping, digests, or smart throttling (deferred to v0.2).
• ❌ Complex policy engines: No Cedar/OPA integration (simple JSON rules only).
• ❌ Multi-approver quorum: Single approver per ticket only.
• ❌ Business hours / SLA tracking: Wall-clock timeouts only.
• ❌ Distributed consensus: Single-node runtime; no multi-region sync.
• ❌ Mobile apps / Slack: CLI and VSCode only.
• ❌ Merkle audit chains: Simple append-only log with checksums.
Post-MVP (v0.2+)
• Intelligent Membrane (batching, auto-rules, risk inference)
• Multi-approver workflows with quorum
• Business hours and SLA tracking
• Cognitive Contract with progressive profiling
• GitHub/Slack/mobile adapters
• Tamper-evident Merkle chains
• QUIC transport and Protobuf envelope
--------------------------------------------------------------------------------
2) Core Concepts
Ticket
A human-addressed request with a defined lifecycle. Contains:
• Intent: What the agent wants to do (e.g., modify_file, deploy, approve_expense)
• Artifact binding: Immutable reference to the thing being approved (file hash, commit SHA, etc.)
• Lease: Timeout duration and behavior (auto_approve, auto_reject, cancel)
• Risk score: 0.0–1.0 computed from change scope and context
Lease
A timer contract attached to a ticket:
• TTL (Time To Live): Wall-clock seconds until expiry
• On Timeout: Action to take if human doesn't respond (auto_approve | auto_reject | cancel)
• Pause Behavior: Timer pauses when ticket is ACKED (human has seen it but not decided)
Event Log
Append-only stream of all HAP events. Each event has:
• Unique ID, timestamp, type, payload
• SHA-256 checksum of (prev_checksum || current_payload)
• No deletion or modification; only appends
Signed Intent
A human's decision, cryptographically bound to:
• Specific ticket ID
• Artifact hash (e.g., Git diff SHA-256)
• Expiry timestamp (30–60 seconds for high-risk actions)
• WebAuthn signature (device-bound credential)
--------------------------------------------------------------------------------
3) Message Types (Wire-Level)
All messages are JSON objects over WebSocket. Each has id, type, ts.
3.1) Ticket Creation

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
        "diff": "...",  // Full unified diff
        "lines_added": 12,
        "lines_removed": 5
      }
    },
    "artifact": {
      "type": "git_diff",
      "repo": "github.com/acme/app",
      "base_commit": "a1b2c3d4",
      "diff_hash": "sha256:e3f8a9b2..."  // Hash of normalized diff text
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

Field Specifications:
• intent.kind: Enum of allowed actions (modify_file, delete_file, run_command, deploy, approve_expense, etc.)
• artifact.diff_hash: SHA-256 of the diff text after normalization (strip timestamps, sort hunks by line number)
• risk: Float 0.0–1.0 (see §5 for calculation)
• priority: low | normal | high | critical (human UX hint; no automatic behavior)
• lease.ttl_seconds: Wall-clock countdown; pauses when state is ACKED
• lease.on_timeout: Must be one of: auto_approve, auto_reject, cancel
3.2) Ticket State Transitions

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

3.3) Human Acknowledgment (Pause Lease)

{
  "id": "evt_01HZ...",
  "type": "ticket.ack",
  "ts": "2025-10-29T10:03:00Z",
  "ticket_id": "tk_9f3",
  "from": "human:alex",
  "note": "Reviewing now..."
}

Effect: Lease timer pauses. Human has seen the ticket and is actively reviewing.
3.4) Signed Intent (Approval/Rejection)

{
  "id": "evt_01J0...",
  "type": "intent.sign",
  "ts": "2025-10-29T10:05:30Z",
  "intent": {
    "ticket_id": "tk_9f3",
    "from": "human:alex",
    "decision": "approve",
    "artifact_hash": "sha256:e3f8a9b2...",  // Must match ticket's artifact.diff_hash
    "expires_at": "2025-10-29T10:06:30Z",  // 60 seconds from now
    "nonce": "n_923f1a...",
    "signature": {
      "algorithm": "ES256",  // WebAuthn ECDSA
      "value": "base64url_encoded_sig...",
      "credential_id": "base64url_encoded_credential..."
    },
    "comment": "LGTM, refactor looks solid"
  }
}

Field Specifications:
• decision: approve | reject | request_changes
• artifact_hash: MUST match the original ticket's artifact.diff_hash
• expires_at: Short expiry (30–60s for critical actions; 5min for low-risk)
• nonce: Random 128-bit value; single-use (stored in event log)
• signature: WebAuthn assertion signature over canonical JSON of {ticket_id, decision, artifact_hash, expires_at, nonce}
3.5) Ticket Timeout

{
  "id": "evt_01J1...",
  "type": "ticket.timeout",
  "ts": "2025-10-29T11:01:05Z",
  "ticket_id": "tk_9f3",
  "action_taken": "auto_reject",
  "reason": "Lease expired after 3600 seconds"
}

3.6) Ticket Cancellation (Agent-Initiated)

{
  "id": "evt_01J2...",
  "type": "ticket.cancel",
  "ts": "2025-10-29T10:10:00Z",
  "ticket_id": "tk_9f3",
  "from": "agent:code_assist",
  "reason": "Code changed; approval no longer relevant"
}

--------------------------------------------------------------------------------
4) Ticket Lifecycle (Finite State Machine)

NEW → PENDING → DELIVERED → ACKED → (APPROVED | REJECTED | CHANGES_REQUESTED)
  ↓       ↓          ↓         ↓
  └───────┴──────────┴─────────┴──────→ CANCELED (from any state)
                                     ↓
                                 EXPIRED (from PENDING or DELIVERED only)

State Definitions
• NEW: Ticket created; not yet queued for delivery
• PENDING: Queued for delivery; lease timer starts
• DELIVERED: Presented to human inbox; lease timer running
• ACKED: Human has opened/seen the ticket; lease timer pauses
• APPROVED: Human approved via signed intent
• REJECTED: Human rejected via signed intent
• CHANGES_REQUESTED: Human requested modifications
• EXPIRED: Lease expired; on_timeout action executed
• CANCELED: Agent or system canceled the ticket
Lease Timer Behavior
State
	
Timer Status
	
Notes
NEW
	
Not started
	
Ticket not yet queued
PENDING
	
Running
	
Countdown begins
DELIVERED
	
Running
	
Human notified but hasn't opened
ACKED
	
Paused
	
Human is actively reviewing
APPROVED/REJECTED
	
Stopped
	
Terminal state
EXPIRED
	
Stopped
	
Timeout reached
CANCELED
	
Stopped
	
Ticket invalidated
Timeout Actions
When a lease expires in PENDING or DELIVERED state:
• auto_approve: Ticket automatically transitions to APPROVED (system-generated intent with from: system:timeout)
• auto_reject: Ticket transitions to REJECTED (system-generated)
• cancel: Ticket transitions to CANCELED
Important: Timeout CANNOT occur after ACKED because the timer is paused. Human must explicitly approve/reject or cancel.
--------------------------------------------------------------------------------
5) Risk Scoring (Baseline Algorithm)
Risk is a float from 0.0 (safe) to 1.0 (dangerous), computed as:

risk = min(1.0, scope_factor * 0.4 + env_factor * 0.4 + confidence_penalty * 0.2)

Scope Factor
Based on magnitude of change:

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

Environment Factor
Based on deployment context (if applicable):

def env_factor(artifact):
    if "prod" in artifact.get("environment", ""):
        return 1.0
    elif "staging" in artifact.get("environment", ""):
        return 0.5
    elif "dev" in artifact.get("environment", ""):
        return 0.2
    else:
        return 0.3  # Default for non-deployment actions

Confidence Penalty
If agent provides self-reported confidence (optional):

def confidence_penalty(agent_confidence):
    # Lower confidence = higher penalty
    if agent_confidence is None:
        return 0.5  # No confidence info = moderate penalty
    else:
        return 1.0 - agent_confidence  # Invert: 0.9 confidence → 0.1 penalty

Example Calculations

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

Note: This is a baseline heuristic. Projects should tune weights and thresholds based on their risk tolerance.
--------------------------------------------------------------------------------
6) Security Model
6.1) Identity
Humans:
• OIDC login (Google, GitHub, Okta, etc.)
• WebAuthn passkey for device-bound credentials
• No passwords; only biometric/hardware keys
Agents:
• API key (MVP: simple bearer tokens)
• Post-MVP: SPIFFE/SVID or mTLS with client certificates
6.2) Signed Intent Verification
Runtime verifies:
1. Signature validity: WebAuthn assertion signature matches public key
2. Artifact binding: intent.artifact_hash matches ticket.artifact.diff_hash
3. Expiry: intent.expires_at is in the future but not too far (max 5 minutes)
4. Nonce uniqueness: intent.nonce hasn't been used before (check event log)
5. Ticket state: Ticket is in ACKED or DELIVERED state (not already resolved)
If any check fails, the intent is rejected and logged as intent.invalid.
6.3) Replay Protection
• Nonces: Each intent includes a random 128-bit nonce; stored in event log to prevent reuse
• Short expiry: High-risk intents expire in 30–60 seconds
• Artifact pinning: Intent is bound to exact diff hash; any change invalidates approval
• Single-use: Once an intent is applied, the ticket transitions to terminal state
6.4) Step-Up Authentication
For risk >= 0.7, the UI prompts for explicit WebAuthn user verification:
1. Show human-readable summary: "You are approving deployment to production affecting 47 files."
2. Require typed confirmation: "Type 'approve production' to continue"
3. Request WebAuthn with userVerification: required (biometric or PIN)
6.5) Transport Security
• WebSocket over TLS 1.3 (wss://)
• Certificate pinning for production deployments
• Agent API keys transmitted in Authorization: Bearer <token> header
6.6) Event Log Integrity (MVP)

def compute_event_hash(event, prev_hash):
    canonical = json.dumps(event, sort_keys=True, separators=(',', ':'))
    data = f"{prev_hash}||{canonical}".encode('utf-8')
    return hashlib.sha256(data).hexdigest()

Each event stores prev_hash and hash. On startup, runtime verifies chain integrity:

def verify_log_integrity(events):
    prev = "0" * 64  # Genesis hash
    for event in events:
        expected = compute_event_hash(event.payload, prev)
        if event.hash != expected:
            raise IntegrityError(f"Event {event.id} hash mismatch")
        prev = event.hash

Post-MVP: Add periodic Merkle tree checkpoints and external anchoring.
--------------------------------------------------------------------------------
7) Reference Runtime Architecture
7.1) Repository Structure

/hap/
  /spec/                    # Protocol specification (this document)
    schemas/                # JSON schemas for messages
      ticket.schema.json
      intent.schema.json
      event.schema.json
  /runtime/
    /packages/
      /core/                # Event bus, FSM, storage
        src/
          events.ts         # Event log with checksum chain
          tickets.ts        # Ticket lifecycle FSM
          leases.ts         # Lease timer management
          storage.ts        # SQLite adapter (Prisma)
      /sdk-ts/              # TypeScript client & server SDK
        src/
          client.ts         # Agent-side: create tickets, subscribe to events
          server.ts         # Runtime server: WebSocket handler
          crypto.ts         # WebAuthn verification, nonce generation
      /cli/                 # Human CLI inbox
        src/
          inbox.ts          # `hap inbox list`, `hap ticket show <id>`
          approve.ts        # `hap approve <id>` (triggers WebAuthn in browser)
      /vscode-ext/          # VSCode extension (human UI)
        src/
          extension.ts      # Sidebar view, diff renderer
          approval.ts       # Approve/reject commands with WebAuthn
    /examples/
      /file-approval/       # Agent requests file modification approval
        agent.ts            # Creates ticket, waits for resolution
        human-flow.md       # Step-by-step human workflow
  /docs/
    quickstart.md
    security.md
    api-reference.md
  package.json
  tsconfig.json
  README.md

7.2) Data Models (Prisma Schema)

// schema.prisma

model Event {
  id        String   @id
  type      String
  ts        DateTime
  payload   Json
  prevHash  String
  hash      String
  createdAt DateTime @default(now())

  @@index([ts])
  @@index([type])
}

model Ticket {
  id          String   @id
  from        String
  to          String
  intent      Json
  artifact    Json
  lease       Json
  risk        Float
  priority    String
  state       String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([to, state])
  @@index([state, createdAt])
}

model UsedNonce {
  nonce     String   @id
  usedAt    DateTime @default(now())
  ticketId  String

  @@index([usedAt])  // For cleanup of old nonces
}

model Human {
  id          String   @id  // "human:alex"
  oidcSub     String   @unique
  email       String
  name        String?
  credentials Json     // WebAuthn credentials
  createdAt   DateTime @default(now())
}

model Agent {
  id        String   @id  // "agent:code_assist"
  apiKey    String   @unique
  name      String
  createdAt DateTime @default(now())
}

7.3) Core APIs (SDK)
Agent SDK (Ticket Creation)

import { HAPClient } from '@hap/sdk-ts';

const hap = new HAPClient({
  serverUrl: 'wss://hap.acme.com',
  agentId: 'agent:code_assist',
  apiKey: process.env.HAP_API_KEY
});

// Create ticket
const ticket = await hap.tickets.create({
  to: 'human:alex',
  intent: {
    kind: 'modify_file',
    summary: 'Refactor authentication middleware',
    details: {
      file: 'src/auth/middleware.ts',
      diff: diffText,
      lines_added: 12,
      lines_removed: 5
    }
  },
  artifact: {
    type: 'git_diff',
    repo: 'github.com/acme/app',
    base_commit: 'a1b2c3d4',
    diff_hash: computeDiffHash(diffText)
  },
  lease: {
    ttl_seconds: 3600,
    on_timeout: 'auto_reject'
  },
  risk: 0.22,
  priority: 'normal'
});

// Subscribe to resolution
hap.tickets.onStateChange(ticket.id, (event) => {
  if (event.to_state === 'APPROVED') {
    console.log('Ticket approved! Applying changes...');
    applyDiff(diffText);
  } else if (event.to_state === 'REJECTED') {
    console.log('Ticket rejected:', event.metadata.comment);
  }
});

Human SDK (Approval)

import { HAPHumanClient } from '@hap/sdk-ts';

const hap = new HAPHumanClient({
  serverUrl: 'wss://hap.acme.com',
  humanId: 'human:alex',
  oidcToken: await getOIDCToken()
});

// List pending tickets
const tickets = await hap.tickets.listPending();

// Acknowledge (pause lease timer)
await hap.tickets.ack(ticketId, 'Reviewing now...');

// Approve with WebAuthn signature
const intent = await hap.intents.sign({
  ticketId: ticketId,
  decision: 'approve',
  artifactHash: ticket.artifact.diff_hash,
  expiresIn: 60,  // seconds
  comment: 'LGTM!'
});

// SDK handles WebAuthn ceremony and signature generation

7.4) WebSocket Protocol
Connection

Client -> Server: WSS handshake with Authorization header
Server -> Client: {"type": "connection.ready", "session_id": "sess_123"}

Subscription

// Client subscribes to ticket updates
{
  "type": "subscribe",
  "resource": "tickets",
  "filter": {"to": "human:alex", "state": ["PENDING", "DELIVERED", "ACKED"]}
}

// Server sends updates
{
  "type": "event",
  "subscription_id": "sub_456",
  "event": {
    "id": "evt_789",
    "type": "ticket.state_change",
    "ticket_id": "tk_9f3",
    "to_state": "DELIVERED",
    ...
  }
}

Heartbeat

// Every 30 seconds
Client -> Server: {"type": "ping"}
Server -> Client: {"type": "pong"}

--------------------------------------------------------------------------------
8) CLI Inbox (Human Interface)
8.1) Commands

# List pending tickets
$ hap inbox list
┌──────────┬──────────┬──────────────────────────────┬──────────┬──────────┐
│ ID       │ Priority │ Summary                      │ Risk     │ Age      │
├──────────┼──────────┼──────────────────────────────┼──────────┼──────────┤
│ tk_9f3   │ normal   │ Refactor auth middleware     │ 0.22     │ 5m       │
│ tk_a1b   │ high     │ Deploy to staging            │ 0.68     │ 12m      │
│ tk_c4d   │ low      │ Fix typo in README           │ 0.05     │ 1h       │
└──────────┴──────────┴──────────────────────────────┴──────────┴──────────┘

# Show ticket details
$ hap ticket show tk_9f3
Ticket: tk_9f3
From: agent:code_assist
Priority: normal
Risk: 0.22 (low)
Created: 2025-10-29 10:01:05 (5 minutes ago)
Lease: Expires in 55 minutes (auto_reject on timeout)

Intent: modify_file
File: src/auth/middleware.ts
Changes: +12 -5 lines

Diff:
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -10,7 +10,10 @@ export function authenticate(req: Request) {
-  if (!token) {
-    throw new Error('No token');
+  if (!token || token.trim() === '') {
+    throw new AuthError('Missing or empty token', {
+      code: 'AUTH_TOKEN_MISSING'
+    });
   }
...

# Acknowledge (pause timer)
$ hap ticket ack tk_9f3 "Reviewing now..."
✓ Ticket acknowledged. Lease timer paused.

# Approve (triggers WebAuthn in browser)
$ hap approve tk_9f3
Opening browser for WebAuthn signature...
✓ Touch your security key
✓ Ticket approved!

# Reject
$ hap reject tk_9f3 "Please add unit tests first"
✓ Ticket rejected with comment.

8.2) WebAuthn Flow (CLI)
Since CLI can't directly access WebAuthn API, it opens a minimal local web server:

$ hap approve tk_9f3
Starting local approval server on http://localhost:8923...
Opening http://localhost:8923/approve?ticket=tk_9f3 in browser...

[Browser opens, shows approval UI with diff, triggers WebAuthn]
[User touches security key]

✓ Approval signed and submitted!

--------------------------------------------------------------------------------
9) VSCode Extension (Human UI)
9.1) Features
• Sidebar Inbox: Shows pending tickets grouped by priority
• Diff Viewer: Inline diff with syntax highlighting
• Approve/Reject: Buttons in diff view; triggers WebAuthn
• Notifications: Toast notifications for new high-priority tickets
• Risk Indicator: Color-coded badge (green < 0.3, yellow 0.3–0.7, red > 0.7)
9.2) UI Mockup

┌─────────────────────────────────────────────┐
│ HAP Inbox                                   │
├─────────────────────────────────────────────┤
│ ● High Priority (1)                         │
│   tk_a1b · Deploy to staging · 12m          │
│   Risk: 0.68 🟡                             │
│                                             │
│ ● Normal (1)                                │
│   tk_9f3 · Refactor auth middleware · 5m    │
│   Risk: 0.22 🟢                             │
│                                             │
│ ● Low (1)                                   │
│   tk_c4d · Fix typo in README · 1h          │
│   Risk: 0.05 🟢                             │
└─────────────────────────────────────────────┘

[User clicks tk_9f3]

┌─────────────────────────────────────────────┐
│ Ticket: tk_9f3                              │
│ Refactor authentication middleware          │
│                                             │
│ From: agent:code_assist                     │
│ Risk: 0.22 (low)                            │
│ Lease: 55m remaining (auto_reject)          │
│                                             │
│ [View Diff] [Approve] [Reject] [Request Changes] │
└─────────────────────────────────────────────┘

[User clicks "View Diff", sees inline diff with approve/reject buttons]

9.3) Extension Code Sketch

// extension.ts
import * as vscode from 'vscode';
import { HAPHumanClient } from '@hap/sdk-ts';

export async function activate(context: vscode.ExtensionContext) {
  const hap = new HAPHumanClient({
    serverUrl: vscode.workspace.getConfiguration('hap').get('serverUrl'),
    humanId: await getHumanId(),
    oidcToken: await getOIDCToken()
  });

  // Create inbox tree view
  const inboxProvider = new InboxTreeProvider(hap);
  vscode.window.registerTreeDataProvider('hapInbox', inboxProvider);

  // Subscribe to new tickets
  hap.tickets.onStateChange('*', (event) => {
    if (event.to_state === 'DELIVERED') {
      inboxProvider.refresh();
      if (event.ticket.priority === 'high' || event.ticket.risk > 0.7) {
        vscode.window.showInformationMessage(
          `New high-priority ticket: ${event.ticket.intent.summary}`,
          'View'
        ).then(action => {
          if (action === 'View') {
            showTicketDiff(event.ticket);
          }
        });
      }
    }
  });

  // Register approve command
  context.subscriptions.push(
    vscode.commands.registerCommand('hap.approve', async (ticketId: string) => {
      const ticket = await hap.tickets.get(ticketId);
      
      // Show diff confirmation
      const confirm = await vscode.window.showInformationMessage(
        `Approve: ${ticket.intent.summary}?\n` +
        `Risk: ${ticket.risk.toFixed(2)} | ` +
        `Changes: +${ticket.intent.details.lines_added} -${ticket.intent.details.lines_removed}`,
        { modal: true },
        'Approve',
        'Cancel'
      );

      if (confirm === 'Approve') {
        // Trigger WebAuthn (opens browser if needed)
        await hap.intents.sign({
          ticketId: ticketId,
          decision: 'approve',
          artifactHash: ticket.artifact.diff_hash,
          expiresIn: 60
        });
        vscode.window.showInformationMessage('✓ Ticket approved!');
        inboxProvider.refresh();
      }
    })
  );
}

--------------------------------------------------------------------------------
10) Example Flow: File Modification Approval
10.1) Agent Code

// agent.ts - AI coding assistant
import { HAPClient } from '@hap/sdk-ts';
import { generateRefactoring, computeDiffHash } from './utils';

const hap = new HAPClient({
  serverUrl: 'wss://hap.local:8080',
  agentId: 'agent:code_assist',
  apiKey: process.env.HAP_API_KEY
});

async function proposeRefactoring(file: string) {
  // Generate refactoring
  const { original, refactored, diff } = await generateRefactoring(file);
  
  // Compute risk
  const linesChanged = diff.additions + diff.deletions;
  const risk = Math.min(1.0, linesChanged / 100 * 0.4 + 0.1);

  // Create ticket
  const ticket = await hap.tickets.create({
    to: 'human:alex',
    intent: {
      kind: 'modify_file',
      summary: `Refactor ${file}`,
      details: {
        file: file,
        diff: diff.text,
        lines_added: diff.additions,
        lines_removed: diff.deletions
      }
    },
    artifact: {
      type: 'git_diff',
      repo: 'github.com/acme/app',
      base_commit: await getCurrentCommit(),
      diff_hash: computeDiffHash(diff.text)
    },
    lease: {
      ttl_seconds: 3600,  // 1 hour
      on_timeout: 'auto_reject'
    },
    risk: risk,
    priority: 'normal'
  });

  console.log(`Ticket created: ${ticket.id}`);

  // Wait for approval (non-blocking)
  return new Promise((resolve, reject) => {
    hap.tickets.onStateChange(ticket.id, (event) => {
      if (event.to_state === 'APPROVED') {
        console.log('✓ Approved! Applying changes...');
        applyDiff(file, diff.text);
        resolve(ticket);
      } else if (event.to_state === 'REJECTED') {
        console.log('✗ Rejected:', event.metadata.comment);
        reject(new Error('Ticket rejected'));
      } else if (event.to_state === 'EXPIRED') {
        console.log('⏱ Expired (auto-rejected by lease)');
        reject(new Error('Ticket expired'));
      }
    });
  });
}

10.2) Human Workflow
1. Agent creates ticket → ticket.create event
2. Runtime delivers ticket → ticket.state_change to DELIVERED
3. Human opens VSCode inbox → sees new ticket with risk=0.22 🟢
4. Human clicks ticket → views diff in editor
5. Human clicks "Acknowledge" → lease timer pauses
6. Human reviews code → checks logic, tests, style
7. Human clicks "Approve" → VSCode triggers WebAuthn
8. Security key tap → generates signed intent with 60s expiry
9. Runtime verifies intent → checks signature, nonce, artifact hash
10. Ticket approved → ticket.state_change to APPROVED
11. Agent receives event → applies diff to file
10.3) Timeline

T+0s     Agent creates ticket (state: PENDING)
T+0.1s   Runtime delivers to human:alex (state: DELIVERED, lease starts)
T+120s   Human opens ticket in VSCode
T+125s   Human clicks "Acknowledge" (state: ACKED, lease pauses)
T+180s   Human reviews diff (30s reading time)
T+210s   Human clicks "Approve" → WebAuthn ceremony
T+212s   Signed intent submitted to runtime
T+212.1s Runtime verifies signature ✓
T+212.2s Runtime checks artifact hash ✓
T+212.3s Runtime checks nonce uniqueness ✓
T+212.4s Ticket state → APPROVED
T+212.5s Agent receives event → applies diff

--------------------------------------------------------------------------------
11) Testing Strategy
11.1) Unit Tests

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

11.2) Integration Tests

// approval-flow.test.ts
describe('Approval Flow', () => {
  it('should complete full agent→human→agent cycle', async () => {
    const agent = createTestAgent();
    const human = createTestHuman();

    // Agent creates ticket
    const ticket = await agent.createTicket({
      to: human.id,
      intent: { kind: 'modify_file', details: { ... } },
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

11.3) Security Tests

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

11.4) Load Tests

// load.test.ts
describe('Load Testing', () => {
  it('should handle 100 concurrent tickets', async () => {
    const agent = createTestAgent();
    const tickets = await Promise.all(
      Array(100).fill(0).map(() => 
        agent.createTicket({ to: 'human:alex', ... })
      )
    );

    expect(tickets).toHaveLength(100);
    tickets.forEach(t => expect(t.state).toBe('PENDING'));
  });

  it('should maintain event log integrity under load', async () => {
    // Create 1000 events rapidly
    for (let i = 0; i < 1000; i++) {
      await createTicket({ ... });
    }

    // Verify chain
    const valid = await verifyEventLogIntegrity();
    expect(valid).toBe(true);
  });
});

--------------------------------------------------------------------------------
12) Error Handling
12.1) Network Failures
Problem: WebSocket disconnects mid-approval
Solution:

class HAPClient {
  private reconnect() {
    this.ws = new WebSocket(this.serverUrl);
    this.ws.on('open', () => {
      // Resubscribe to pending tickets
      this.tickets.resubscribe();
    });
  }
}

Guarantees:
• All events stored in append-only log
• Clients can replay from last seen event ID
• Idempotent ticket creation (client-generated IDs)
12.2) Corrupt Event Log
Detection:

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

Recovery:
• Stop runtime immediately
• Alert administrators
• Restore from backup
• Investigate tampering source
12.3) Agent Crash During Ticket Lifecycle
Problem: Agent creates ticket, then crashes before handling approval
Solution:
• Ticket remains in APPROVED state in event log
• Agent can query all approved tickets on restart:
12.4) Human Approves Stale Artifact
Problem: Human approves diff, but code changed (rebase) before agent applies
Solution:
• Agent must re-verify artifact hash before applying:
--------------------------------------------------------------------------------
13) Monitoring & Observability
13.1) Metrics (Prometheus)

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

13.2) Traces (OpenTelemetry)

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

13.3) Logs (Structured JSON)

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

13.4) Dashboards
Key Metrics to Track:
• Approval latency: p50, p95, p99 by priority
• Timeout rate: % of tickets expired vs. resolved
• Risk distribution: histogram of ticket risk scores
• Human load: tickets/hour per human
• Security events: nonce reuse, signature failures, expired intents
--------------------------------------------------------------------------------
14) Deployment Guide
14.1) Local Development

# Clone repository
git clone https://github.com/cortiq/hap.git
cd hap/runtime

# Install dependencies
npm install

# Set up SQLite database
npx prisma migrate dev

# Start runtime server
npm run dev  # Runs on ws://localhost:8080

# In another terminal, start example agent
cd examples/file-approval
npm install
npm start

# In another terminal, open CLI inbox
cd ../..
npm run cli inbox list

14.2) Production Deployment (Docker)

# docker-compose.yml
version: '3.8'
services:
  hap-runtime:
    image: cortiq/hap-runtime:0.1.0
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://hap:password@postgres:5432/hap
      - OIDC_ISSUER=https://accounts.google.com
      - OIDC_CLIENT_ID=your-client-id
      - LOG_LEVEL=info
    volumes:
      - ./data:/data
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=hap
      - POSTGRES_USER=hap
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:

docker-compose up -d

14.3) Kubernetes Deployment

# hap-runtime-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hap-runtime
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hap-runtime
  template:
    metadata:
      labels:
        app: hap-runtime
    spec:
      containers:
      - name: runtime
        image: cortiq/hap-runtime:0.1.0
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: hap-secrets
              key: database-url
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: hap-runtime
spec:
  selector:
    app: hap-runtime
  ports:
  - port: 8080
    targetPort: 8080
  type: LoadBalancer

--------------------------------------------------------------------------------
15) Migration from Existing Systems
15.1) GitHub PR Reviews → HAP

// Adapter: Convert GitHub PR to HAP ticket
import { Octokit } from '@octokit/rest';
import { HAPClient } from '@hap/sdk-ts';

const github = new Octokit({ auth: process.env.GITHUB_TOKEN });
const hap = new HAPClient({ ... });

github.webhooks.on('pull_request.opened', async ({ payload }) => {
  const pr = payload.pull_request;
  const diff = await github.pulls.get({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: pr.number,
    mediaType: { format: 'diff' }
  });

  const ticket = await hap.tickets.create({
    to: `human:${pr.requested_reviewers[0].login}`,
    intent: {
      kind: 'review_pr',
      summary: pr.title,
      details: {
        pr_url: pr.html_url,
        diff: diff.data,
        additions: pr.additions,
        deletions: pr.deletions
      }
    },
    artifact: {
      type: 'git_diff',
      repo: pr.base.repo.full_name,
      base_commit: pr.base.sha,
      head_commit: pr.head.sha,
      diff_hash: computeDiffHash(diff.data)
    },
    lease: {
      ttl_seconds: 86400,  // 24 hours
      on_timeout: 'cancel'
    },
    risk: computeRisk(pr.additions + pr.deletions),
    priority: pr.draft ? 'low' : 'normal'
  });

  // Link ticket to PR
  await github.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: pr.number,
    body: `HAP Ticket: [${ticket.id}](https://hap.acme.com/tickets/${ticket.id})`
  });
});

--------------------------------------------------------------------------------
16) Roadmap
MVP (Weeks 1-6)
Week 1-2: Core Protocol
• [x] Define message schemas (JSON Schema)
• [x] Implement ticket FSM
• [x] Implement lease timer with pause/resume
• [x] Build event log with checksum chain
• [x] Write unit tests
Week 3-4: Runtime & SDK
• [ ] Implement WebSocket server
• [ ] Build TypeScript SDK (client + server)
• [ ] Implement WebAuthn signing
• [ ] Build Prisma storage layer
• [ ] Integration tests
Week 5: CLI Inbox
• [ ] hap inbox list/show
• [ ] hap ticket ack/approve/reject
• [ ] WebAuthn flow via local web server
• [ ] End-to-end tests
Week 6: VSCode Extension
• [ ] Sidebar tree view
• [ ] Diff viewer
• [ ] Approve/reject commands
• [ ] WebAuthn integration
• [ ] Example agent (file approval)
v0.2 (Weeks 7-12)
• [ ] Intelligent Membrane (batching, auto-rules)
• [ ] GitHub adapter (PR reviews)
• [ ] Business hours and SLA tracking
• [ ] Multi-approver quorum
• [ ] Risk taxonomy expansion
• [ ] Performance optimization (1000+ tickets/sec)
v0.3 (Weeks 13-18)
• [ ] Cognitive Contract with endorsements
• [ ] Progressive profiling and skill inference
• [ ] Slack adapter
• [ ] Mobile PWA inbox
• [ ] QUIC transport
• [ ] Protobuf envelope option
v1.0 (Weeks 19-24)
• [ ] Merkle audit chains with external anchoring
• [ ] Cedar/OPA policy engine integration
• [ ] HAP-Lite compliance spec for vendors
• [ ] Production hardening (HA, disaster recovery)
• [ ] Formal security audit
• [ ] Public launch
--------------------------------------------------------------------------------
17) Open Questions (To Resolve Before v0.2)
17.1) Business Hours Handling
Question: How do we handle multi-timezone teams with complex schedules (holidays, PTO, oncall)?
Options:
• A) Integrate with Google Calendar / Outlook
• B) Use IANA timezone database + manual holiday config
• C) Defer to v0.3; use wall-clock TTLs for now
Decision: Start with (C), add (B) in v0.2, explore (A) for v0.3.
17.2) Escalation Chains
Question: What happens when escalation target is also unavailable?
Options:
• A) Max escalation depth (e.g., 3 levels), then auto-cancel
• B) Broadcast to entire team after N failed escalations
• C) Alert oncall rotation system
Decision: Implement (A) for MVP with configurable max depth.
17.3) Risk Taxonomy
Question: Should we standardize risk categories like CWE for vulnerabilities?
Options:
• A) Create HAP Risk Taxonomy (HRT) with categories like "data_leak", "availability_impact", "auth_bypass"
• B) Use existing standards (OWASP, MITRE ATT&CK)
• C) Keep risk as simple float; let projects define their own categories
Decision: Start with (C) for MVP; explore (A) for v0.2 based on community feedback.
17.4) Multi-Approver Conflicts
Question: If 2 of 3 approvers say yes, then code changes (rebase), do approvals auto-invalidate?
Options:
• A) Yes, always invalidate on artifact change
• B) Only invalidate if diff has "substantial" changes (need heuristic)
• C) Let human policy decide (configurable per ticket)
Decision: Defer multi-approver to v0.2; implement (A) for single-approver tickets in MVP.
--------------------------------------------------------------------------------
18) Security Considerations
18.1) Threat Model
Assumed Attacker Capabilities:
• Network eavesdropping (TLS mitigates)
• Compromised agent API key
• Stolen human OIDC token (short-lived)
• Physical access to human's device (WebAuthn mitigates)
Out of Scope (MVP):
• Runtime server compromise (assume trusted)
• Zero-day in WebAuthn implementation
• Social engineering of humans
18.2) Mitigations
Threat
	
Mitigation
Replay attack
	
Nonces + short expiry + artifact pinning
Man-in-the-middle
	
TLS 1.3 + certificate pinning
Stolen API key
	
Rotate keys frequently + monitor for abuse
Approval of wrong artifact
	
Cryptographic binding to diff hash
Compromised agent
	
API key revocation + audit log investigation
Human coercion
	
Step-up auth for high-risk actions
18.3) Security Audit Checklist (Pre-v1.0)
• [ ] Third-party penetration test
• [ ] WebAuthn implementation review (FIDO Alliance)
• [ ] Cryptographic review (nonce generation, signature verification)
• [ ] Event log integrity verification
• [ ] TLS configuration review (cipher suites, certificate validation)
• [ ] Input validation and sanitization audit
• [ ] Dependency vulnerability scan (npm audit, Snyk)
--------------------------------------------------------------------------------
19) Compliance & Legal
19.1) GDPR Considerations
Personal Data Stored:
• Human email, name (from OIDC)
• WebAuthn credential IDs (device identifiers)
• Ticket metadata (file paths, commit messages)
Rights Implementation:
• Right to access: hap export-data --human-id=human:alex
• Right to deletion: hap delete-human --human-id=human:alex (anonymizes event log entries)
• Right to portability: JSON export of all tickets and intents
19.2) SOC2 Readiness
Type II Controls:
• Append-only audit log (detective)
• Cryptographic signatures (preventive)
• Role-based access control (preventive)
• Monitoring and alerting (detective)
19.3) License
Protocol Specification: CC BY 4.0 (attribution required, commercial use allowed)
Reference Runtime: Apache 2.0 (permissive, compatible with commercial use)
--------------------------------------------------------------------------------
20) Community & Governance
20.1) RFC Process (Post-MVP)
1. Draft RFC as GitHub issue with [RFC] prefix
2. Community discussion (2 weeks)
3. Address feedback and revise
4. Core team approval (simple majority)
5. Merge into spec repository
6. Implement in reference runtime
20.2) Backwards Compatibility
Versioning: Semantic versioning (MAJOR.MINOR.PATCH)
• MAJOR: Breaking wire protocol changes (e.g., removing message fields)
• MINOR: Additive changes (e.g., new message types, optional fields)
• PATCH: Bug fixes, documentation
Compatibility Promise:
• v0.x: No compatibility guarantees (experimental)
• v1.x: Backwards compatible within major version
• Clients MUST ignore unknown fields (forward compatibility)
20.3) Reference Implementations
Planned:
• TypeScript (reference, this spec)
• Python (community-maintained)
• Go (community-maintained)
• Rust (community-maintained)
Adapters:
• VSCode (reference)
• GitHub Actions (reference)
• Neovim (community)
• Emacs (community)
• JetBrains IDEs (community)
• Slack (community)
• Discord (community)
--------------------------------------------------------------------------------
21) Appendix A: JSON Schemas
21.1) Ticket Schema

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://hap-protocol.org/schemas/ticket.json",
  "title": "Ticket",
  "type": "object",
  "required": ["id", "from", "to", "intent", "artifact", "lease", "risk", "priority", "created_at"],
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
      "type": "object",
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

21.2) Signed Intent Schema

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

--------------------------------------------------------------------------------
22) Appendix B: Glossary
• Ticket: A request from an agent to a human for approval/review
• Lease: A timeout contract specifying TTL and behavior on expiry
• Intent: A human's signed decision (approve/reject) bound to an artifact
• Artifact: The immutable thing being approved (file, diff, command, etc.)
• Risk Score: A float 0.0–1.0 indicating danger level of the action
• FSM (Finite State Machine): The ticket lifecycle state transitions
• Event Log: Append-only stream of all HAP messages
• Nonce: A random single-use value preventing replay attacks
• WebAuthn: W3C standard for device-bound authentication (passkeys)
• Membrane: (v0.2+) The intelligent batching/throttling layer for humans
• Cognitive Contract: (v0.2+) A profile of human skills, roles, preferences
--------------------------------------------------------------------------------
23) Appendix C: Related Work
Similar Protocols:
• Model Context Protocol (MCP): IDE ↔ LLM communication (Anthropic)
• Agent Communication Protocol (ACP): Agent-to-agent messaging
• OpenAPI: REST API specification
Differences:
• HAP is human-centric (not LLM-centric or agent-centric)
• HAP has built-in timeout/escalation semantics
• HAP mandates cryptographic approval signatures
Inspiration:
• BPMN (Business Process Model and Notation): Human task nodes in workflows
• Camunda/Temporal: Workflow engines with human tasks
• GitHub PR Reviews: Asynchronous approval flow with artifact binding
--------------------------------------------------------------------------------
24) Conclusion
HAP provides a minimal, secure, and auditable protocol for human-agent collaboration. This revised RFC defines an achievable 6-week MVP focused on:
✅ Core ticket lifecycle with FSM ✅ Latency-safe lease semantics with pause/resume ✅ Cryptographically signed approvals with WebAuthn ✅ Append-only event log with integrity checks ✅ Simple risk scoring algorithm ✅ CLI and VSCode interfaces ✅ Example file approval flow
Next Steps:
1. Review and finalize this RFC with stakeholders
2. Implement core runtime (Weeks 1-4)
3. Build CLI inbox (Week 5)
4. Build VSCode extension (Week 6)
5. Gather feedback from early adopters
6. Plan v0.2 roadmap based on usage data
--------------------------------------------------------------------------------
End of Revised RFC v0.1
For questions or contributions, contact: spinualexandru@outlook.com
