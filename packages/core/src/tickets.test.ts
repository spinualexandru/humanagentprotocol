import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TicketService } from './tickets.js';
import { Storage } from './storage.js';
import { EventLog } from './events.js';

describe('TicketService', () => {
  let storage: Storage;
  let eventLog: EventLog;
  let service: TicketService;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Storage(':memory:');
    eventLog = new EventLog(storage);
    service = new TicketService(storage, eventLog);
  });

  afterEach(() => {
    vi.useRealTimers();
    service.dispose();
  });

  it('creates a ticket in PENDING state', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1,
      priority: 'normal',
    }, 'agent:test');
    expect(ticket.state).toBe('PENDING');
    expect(ticket.id).toMatch(/^tk_/);
  });

  it('transitions PENDING -> DELIVERED', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.deliver(ticket.id);
    expect(service.get(ticket.id)!.state).toBe('DELIVERED');
  });

  it('transitions DELIVERED -> ACKED', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.deliver(ticket.id);
    service.ack(ticket.id, 'human:alex', 'reviewing');
    expect(service.get(ticket.id)!.state).toBe('ACKED');
  });

  it('transitions ACKED -> APPROVED', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.deliver(ticket.id);
    service.ack(ticket.id, 'human:alex');
    service.resolve(ticket.id, 'human:alex', 'approve');
    expect(service.get(ticket.id)!.state).toBe('APPROVED');
  });

  it('rejects invalid state transitions', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    // PENDING -> ACKED is not valid (must go through DELIVERED)
    expect(() => service.ack(ticket.id, 'human:alex')).toThrow();
  });

  it('auto-rejects on lease timeout', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 10, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.deliver(ticket.id);
    vi.advanceTimersByTime(11_000);
    expect(service.get(ticket.id)!.state).toBe('EXPIRED');
  });

  it('pauses lease on ACK', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 10, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.deliver(ticket.id);
    vi.advanceTimersByTime(5_000);
    service.ack(ticket.id, 'human:alex');
    vi.advanceTimersByTime(20_000);
    expect(service.get(ticket.id)!.state).toBe('ACKED');
  });

  it('cancels a ticket from any non-terminal state', () => {
    const ticket = service.create({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal',
    }, 'agent:test');
    service.cancel(ticket.id, 'agent:test', 'no longer needed');
    expect(service.get(ticket.id)!.state).toBe('CANCELED');
  });
});
