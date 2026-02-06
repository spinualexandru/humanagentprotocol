import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HapEngine } from './engine.js';

describe('HapEngine', () => {
  let engine: HapEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new HapEngine(':memory:');
  });

  afterEach(() => {
    vi.useRealTimers();
    engine.dispose();
  });

  it('full lifecycle: create -> deliver -> ack -> approve', () => {
    const ticket = engine.createTicket({
      to: 'human:alex', summary: 'Refactor auth', from: 'agent:test',
    });
    expect(ticket.state).toBe('PENDING');

    engine.deliverTicket(ticket.id);
    expect(engine.getTicket(ticket.id)!.state).toBe('DELIVERED');

    engine.ackTicket(ticket.id, 'human:alex');
    expect(engine.getTicket(ticket.id)!.state).toBe('ACKED');

    engine.approveTicket(ticket.id, 'human:alex', 'LGTM');
    expect(engine.getTicket(ticket.id)!.state).toBe('APPROVED');
  });

  it('rejects a ticket', () => {
    const ticket = engine.createTicket({
      to: 'human:alex', summary: 'Bad change', from: 'agent:test',
    });
    engine.deliverTicket(ticket.id);
    engine.rejectTicket(ticket.id, 'human:alex', 'Not acceptable');
    expect(engine.getTicket(ticket.id)!.state).toBe('REJECTED');
  });

  it('event log maintains integrity', () => {
    engine.createTicket({ to: 'human:alex', summary: 'test1', from: 'agent:test' });
    engine.createTicket({ to: 'human:alex', summary: 'test2', from: 'agent:test' });
    expect(engine.verifyEventLog()).toBe(true);
  });
});
