import { describe, it, expect, beforeEach } from 'vitest';
import { Storage } from './storage.js';

describe('Storage', () => {
  let db: Storage;

  beforeEach(() => {
    db = new Storage(':memory:');
  });

  it('creates and retrieves a ticket', () => {
    const ticket = db.createTicket({
      id: 'tk_abc12345',
      from: 'agent:test',
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      artifact: null,
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1,
      priority: 'normal',
      state: 'PENDING',
    });
    expect(ticket.id).toBe('tk_abc12345');

    const retrieved = db.getTicket('tk_abc12345');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.state).toBe('PENDING');
  });

  it('updates ticket state', () => {
    db.createTicket({
      id: 'tk_abc12345', from: 'agent:test', to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'test', details: {} },
      artifact: null, lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal', state: 'PENDING',
    });
    db.updateTicketState('tk_abc12345', 'DELIVERED');
    expect(db.getTicket('tk_abc12345')!.state).toBe('DELIVERED');
  });

  it('lists pending tickets for a human', () => {
    db.createTicket({
      id: 'tk_aaa00001', from: 'agent:test', to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'one', details: {} },
      artifact: null, lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1, priority: 'normal', state: 'PENDING',
    });
    db.createTicket({
      id: 'tk_bbb00002', from: 'agent:test', to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'two', details: {} },
      artifact: null, lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.5, priority: 'high', state: 'PENDING',
    });
    const pending = db.listPendingTickets('human:alex');
    expect(pending).toHaveLength(2);
  });

  it('appends and retrieves events', () => {
    db.appendEvent({
      id: 'evt_001', type: 'ticket.create', ts: new Date().toISOString(),
      payload: { ticket_id: 'tk_abc12345' }, prev_hash: '0'.repeat(64), hash: 'abc',
    });
    const events = db.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ticket.create');
  });

  it('tracks used nonces', () => {
    expect(db.isNonceUsed('n_test123')).toBe(false);
    db.markNonceUsed('n_test123', 'tk_abc12345');
    expect(db.isNonceUsed('n_test123')).toBe(true);
  });
});
