import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HapEngine } from '@hap/core';

/**
 * Tests for the HAP hook logic (tool risk scoring, summary building, ticket flow).
 * We test the core behavior without spawning the actual hook process.
 */

// Replicate the risk logic from hook.ts
function toolRisk(toolName: string, toolInput: Record<string, unknown>): { risk: number; priority: string } {
  switch (toolName) {
    case 'Bash': {
      const cmd = String(toolInput.command ?? '');
      if (/\brm\s+-rf\b|--force|reset\s+--hard|push\s+--force|drop\s+/.test(cmd)) {
        return { risk: 0.95, priority: 'critical' };
      }
      if (/\bgit\s+push\b|\bdocker\b|\bdeploy\b|\bkubectl\b/.test(cmd)) {
        return { risk: 0.75, priority: 'high' };
      }
      if (/\bnpm\s+(install|ci)\b|\bcargo\s+build\b|\bmake\b/.test(cmd)) {
        return { risk: 0.4, priority: 'normal' };
      }
      return { risk: 0.6, priority: 'normal' };
    }
    case 'Edit':
      return { risk: 0.35, priority: 'normal' };
    case 'Write':
      return { risk: 0.45, priority: 'normal' };
    case 'Task':
      return { risk: 0.3, priority: 'low' };
    default:
      return { risk: 0.5, priority: 'normal' };
  }
}

describe('HAP Hook — Risk Scoring', () => {
  it('scores rm -rf as critical', () => {
    const { risk, priority } = toolRisk('Bash', { command: 'rm -rf /tmp/test' });
    expect(risk).toBe(0.95);
    expect(priority).toBe('critical');
  });

  it('scores git push as high', () => {
    const { risk, priority } = toolRisk('Bash', { command: 'git push origin main' });
    expect(risk).toBe(0.75);
    expect(priority).toBe('high');
  });

  it('scores npm install as normal', () => {
    const { risk } = toolRisk('Bash', { command: 'npm install express' });
    expect(risk).toBe(0.4);
  });

  it('scores generic bash as normal', () => {
    const { risk } = toolRisk('Bash', { command: 'ls -la' });
    expect(risk).toBe(0.6);
  });

  it('scores Edit as normal low-risk', () => {
    const { risk } = toolRisk('Edit', { file_path: '/tmp/test.ts', old_string: 'a', new_string: 'b' });
    expect(risk).toBe(0.35);
  });

  it('scores Write as normal medium-risk', () => {
    const { risk } = toolRisk('Write', { file_path: '/tmp/test.ts', content: 'hello' });
    expect(risk).toBe(0.45);
  });
});

describe('HAP Hook — Ticket Creation & Approval Flow', () => {
  let engine: HapEngine;

  beforeEach(() => {
    engine = new HapEngine(':memory:');
  });

  afterEach(() => {
    engine.dispose();
  });

  it('creates a ticket for a Bash tool call', () => {
    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:claude_code',
      summary: 'Run command: npm test',
      intent_kind: 'tool:Bash',
      details: { tool_name: 'Bash', tool_input: { command: 'npm test' } },
      risk: 0.6,
      priority: 'normal',
      ttl_seconds: 300,
      on_timeout: 'auto_reject',
    });
    engine.deliverTicket(ticket.id);

    expect(ticket.state).toBe('PENDING');
    expect(ticket.intent.kind).toBe('tool:Bash');
    expect(engine.listPending('human:alex')).toHaveLength(1);
  });

  it('approving the ticket allows the tool call', () => {
    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:claude_code',
      summary: 'Edit file: src/index.ts',
      intent_kind: 'tool:Edit',
      risk: 0.35,
      priority: 'normal',
      ttl_seconds: 300,
      on_timeout: 'auto_reject',
    });
    engine.deliverTicket(ticket.id);
    engine.ackTicket(ticket.id, 'human:alex');
    engine.approveTicket(ticket.id, 'human:alex', 'looks good');

    const resolved = engine.getTicket(ticket.id)!;
    expect(resolved.state).toBe('APPROVED');
  });

  it('rejecting the ticket blocks the tool call', () => {
    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:claude_code',
      summary: 'Run command: rm -rf /',
      intent_kind: 'tool:Bash',
      risk: 0.95,
      priority: 'critical',
      ttl_seconds: 300,
      on_timeout: 'auto_reject',
    });
    engine.deliverTicket(ticket.id);
    engine.ackTicket(ticket.id, 'human:alex');
    engine.rejectTicket(ticket.id, 'human:alex', 'absolutely not');

    const resolved = engine.getTicket(ticket.id)!;
    expect(resolved.state).toBe('REJECTED');
  });
});
