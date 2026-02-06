#!/usr/bin/env node
/**
 * HAP PreToolUse Hook for Claude Code
 *
 * Replaces Claude's standard permission system with HAP ticket approval.
 * Reads tool call info from stdin, creates a HAP ticket for write/execute
 * operations, and blocks until the human approves or rejects.
 *
 * Exit behavior (JSON on stdout):
 *   permissionDecision: "allow"  → tool proceeds
 *   permissionDecision: "deny"   → tool blocked
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { HapEngine } from '@hap/core';

// ── Configuration ──────────────────────────────────────────────────────

const DB_PATH = process.env.HAP_DB_PATH ?? resolve(homedir(), '.hap', 'hap.db');
const HUMAN_ID = process.env.HAP_HUMAN_ID ?? 'human:alex';
const POLL_INTERVAL_MS = 400;
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

// Tools that never need approval (read-only, no side effects)
const ALWAYS_ALLOW = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskCreate',
  'TaskUpdate',
  'TaskStop',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
  // Context7 MCP tools
  'mcp__plugin_context7_context7__resolve-library-id',
  'mcp__plugin_context7_context7__query-docs',
  // HAP's own MCP tools (prevent infinite recursion!)
  'mcp__hap-bridge__hap_create_ticket',
  'mcp__hap-bridge__hap_list_pending',
  'mcp__hap-bridge__hap_get_ticket',
  'mcp__hap-bridge__hap_approve_ticket',
  'mcp__hap-bridge__hap_reject_ticket',
  'mcp__hap-bridge__hap_ack_ticket',
]);

// Risk scoring per tool type
function toolRisk(toolName: string, toolInput: Record<string, unknown>): { risk: number; priority: 'low' | 'normal' | 'high' | 'critical' } {
  switch (toolName) {
    case 'Bash': {
      const cmd = String(toolInput.command ?? '');
      // Destructive commands are critical
      if (/\brm\s+-rf\b|--force|reset\s+--hard|push\s+--force|drop\s+/.test(cmd)) {
        return { risk: 0.95, priority: 'critical' };
      }
      // Git push, docker, deploy-like commands
      if (/\bgit\s+push\b|\bdocker\b|\bdeploy\b|\bkubectl\b/.test(cmd)) {
        return { risk: 0.75, priority: 'high' };
      }
      // Package install, build commands
      if (/\bnpm\s+(install|ci)\b|\bcargo\s+build\b|\bmake\b/.test(cmd)) {
        return { risk: 0.4, priority: 'normal' };
      }
      // Other shell commands
      return { risk: 0.6, priority: 'normal' };
    }
    case 'Edit':
      return { risk: 0.35, priority: 'normal' };
    case 'Write':
      return { risk: 0.45, priority: 'normal' };
    case 'NotebookEdit':
      return { risk: 0.4, priority: 'normal' };
    case 'Task':
      return { risk: 0.3, priority: 'low' };
    default:
      return { risk: 0.5, priority: 'normal' };
  }
}

// Build a human-readable summary of the tool call
function buildSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = String(toolInput.command ?? '').slice(0, 120);
      const desc = toolInput.description ? ` — ${toolInput.description}` : '';
      return `Run command: ${cmd}${desc}`;
    }
    case 'Edit': {
      const file = String(toolInput.file_path ?? 'unknown');
      return `Edit file: ${file}`;
    }
    case 'Write': {
      const file = String(toolInput.file_path ?? 'unknown');
      return `Write file: ${file}`;
    }
    case 'NotebookEdit': {
      const nb = String(toolInput.notebook_path ?? 'unknown');
      return `Edit notebook: ${nb}`;
    }
    case 'Task': {
      const desc = String(toolInput.description ?? toolInput.prompt ?? '').slice(0, 100);
      return `Launch agent: ${desc}`;
    }
    default:
      return `${toolName}: ${JSON.stringify(toolInput).slice(0, 100)}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function output(decision: 'allow' | 'deny', reason?: string): never {
  const result: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Read hook input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: {
    tool_name: string;
    tool_input: Record<string, unknown>;
    session_id?: string;
    tool_use_id?: string;
    [key: string]: unknown;
  };

  try {
    input = JSON.parse(raw);
  } catch {
    // Can't parse input — allow by default to not break Claude
    output('allow');
  }

  const toolName = input!.tool_name;
  const toolInput = input!.tool_input ?? {};

  // Auto-allow safe tools
  if (ALWAYS_ALLOW.has(toolName)) {
    output('allow');
  }

  // Compute risk and build ticket
  const { risk, priority } = toolRisk(toolName, toolInput);
  const summary = buildSummary(toolName, toolInput);

  // Ensure DB directory exists
  mkdirSync(resolve(DB_PATH, '..'), { recursive: true });

  const engine = new HapEngine(DB_PATH);

  try {
    // Create and deliver the ticket
    const ticket = engine.createTicket({
      to: HUMAN_ID,
      from: `agent:claude_code`,
      summary,
      intent_kind: `tool:${toolName}`,
      details: {
        tool_name: toolName,
        tool_input: toolInput,
        session_id: input!.session_id,
        tool_use_id: input!.tool_use_id,
      },
      risk,
      priority,
      ttl_seconds: DEFAULT_TTL_SECONDS,
      on_timeout: 'auto_reject',
    });
    engine.deliverTicket(ticket.id);

    // Print to stderr so the human sees it in their terminal
    process.stderr.write(
      `\x1b[36m[HAP]\x1b[0m Ticket \x1b[1m${ticket.id}\x1b[0m created — ${summary}\n` +
      `\x1b[36m[HAP]\x1b[0m Approve: \x1b[32mhap approve ${ticket.id}\x1b[0m | Reject: \x1b[31mhap reject ${ticket.id}\x1b[0m\n`
    );

    // Poll for resolution
    const deadline = Date.now() + DEFAULT_TTL_SECONDS * 1000;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const current = engine.getTicket(ticket.id);
      if (!current) {
        output('deny', 'Ticket disappeared');
      }

      const state = current!.state;
      if (state === 'APPROVED') {
        output('allow', `HAP ticket ${ticket.id} approved`);
      } else if (state === 'REJECTED' || state === 'CHANGES_REQUESTED') {
        output('deny', `HAP ticket ${ticket.id} rejected`);
      } else if (state === 'EXPIRED') {
        output('deny', `HAP ticket ${ticket.id} expired (auto-rejected)`);
      } else if (state === 'CANCELED') {
        output('deny', `HAP ticket ${ticket.id} canceled`);
      }
      // PENDING, DELIVERED, ACKED → keep polling
    }

    // Timeout reached (shouldn't happen if lease works, but safety net)
    output('deny', `HAP ticket ${ticket.id} timed out waiting for approval`);
  } finally {
    engine.dispose();
  }
}

main().catch((err) => {
  // On any error, let the tool through to avoid breaking Claude
  process.stderr.write(`[HAP] Hook error: ${err}\n`);
  output('allow', 'HAP hook error — allowing by default');
});
