import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HapEngine } from './engine.js';

describe('Integration: Full HAP Lifecycle', () => {
  let engine: HapEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new HapEngine(':memory:');
  });

  afterEach(() => {
    vi.useRealTimers();
    engine.dispose();
  });

  it('agent creates ticket -> human approves -> event log is valid', () => {
    // Agent creates ticket
    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:code_assist',
      summary: 'Refactor authentication middleware',
      file: 'src/auth/middleware.ts',
      diff: '--- a/src/auth/middleware.ts\n+++ b/src/auth/middleware.ts\n@@ -10,3 +10,5 @@\n-old code\n+new code\n+more code',
      lines_added: 12,
      lines_removed: 5,
      priority: 'normal',
      ttl_seconds: 3600,
      on_timeout: 'auto_reject',
    });

    expect(ticket.state).toBe('PENDING');
    expect(ticket.id).toMatch(/^tk_/);
    expect(ticket.risk).toBeGreaterThan(0);

    // Runtime delivers
    engine.deliverTicket(ticket.id);
    expect(engine.getTicket(ticket.id)!.state).toBe('DELIVERED');

    // Human sees inbox
    const pending = engine.listPending('human:alex');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(ticket.id);

    // Human acknowledges
    engine.ackTicket(ticket.id, 'human:alex', 'Reviewing now...');
    expect(engine.getTicket(ticket.id)!.state).toBe('ACKED');

    // Human approves
    engine.approveTicket(ticket.id, 'human:alex', 'LGTM, refactor looks solid');
    expect(engine.getTicket(ticket.id)!.state).toBe('APPROVED');

    // Ticket no longer in pending
    expect(engine.listPending('human:alex')).toHaveLength(0);

    // Event log is valid
    expect(engine.verifyEventLog()).toBe(true);

    // Event log has correct sequence
    const events = engine.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(4);
    const types = events.map(e => e.type);
    expect(types).toContain('ticket.create');
    expect(types).toContain('ticket.state_change');
    expect(types).toContain('ticket.ack');
    expect(types).toContain('intent.sign');
  });

  it('agent creates ticket -> lease expires -> auto-reject', () => {
    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:code_assist',
      summary: 'Deploy to production',
      priority: 'high',
      risk: 0.85,
      ttl_seconds: 30,
      on_timeout: 'auto_reject',
    });

    engine.deliverTicket(ticket.id);
    expect(engine.getTicket(ticket.id)!.state).toBe('DELIVERED');

    // No human response for 31 seconds
    vi.advanceTimersByTime(31_000);
    expect(engine.getTicket(ticket.id)!.state).toBe('EXPIRED');

    // Event log records timeout
    expect(engine.verifyEventLog()).toBe(true);
    const events = engine.getEvents();
    const timeoutEvent = events.find(e => e.type === 'ticket.timeout');
    expect(timeoutEvent).toBeDefined();
  });

  it('multiple tickets for same human', () => {
    const t1 = engine.createTicket({ to: 'human:alex', from: 'agent:a', summary: 'Fix bug' });
    const t2 = engine.createTicket({ to: 'human:alex', from: 'agent:b', summary: 'Add feature' });
    const t3 = engine.createTicket({ to: 'human:alex', from: 'agent:c', summary: 'Update docs' });

    engine.deliverTicket(t1.id);
    engine.deliverTicket(t2.id);
    engine.deliverTicket(t3.id);

    expect(engine.listPending('human:alex')).toHaveLength(3);

    engine.approveTicket(t1.id, 'human:alex');
    expect(engine.listPending('human:alex')).toHaveLength(2);

    engine.rejectTicket(t2.id, 'human:alex', 'Not now');
    expect(engine.listPending('human:alex')).toHaveLength(1);

    engine.cancelTicket(t3.id, 'agent:c', 'Superseded');
    expect(engine.listPending('human:alex')).toHaveLength(0);

    expect(engine.verifyEventLog()).toBe(true);
  });

  it('approve from DELIVERED without explicit ack', () => {
    const ticket = engine.createTicket({
      to: 'human:alex', from: 'agent:test', summary: 'Quick fix',
    });
    engine.deliverTicket(ticket.id);

    // Approve directly from DELIVERED (skip ACK)
    engine.approveTicket(ticket.id, 'human:alex', 'Ship it');
    expect(engine.getTicket(ticket.id)!.state).toBe('APPROVED');
    expect(engine.verifyEventLog()).toBe(true);
  });
});
