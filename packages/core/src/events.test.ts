import { describe, it, expect, beforeEach } from 'vitest';
import { EventLog } from './events.js';
import { Storage } from './storage.js';

describe('EventLog', () => {
  let storage: Storage;
  let log: EventLog;

  beforeEach(() => {
    storage = new Storage(':memory:');
    log = new EventLog(storage);
  });

  it('appends event with correct hash chain', () => {
    const evt = log.append('ticket.create', { ticket_id: 'tk_abc12345' });
    expect(evt.prev_hash).toBe('0'.repeat(64));
    expect(evt.hash).toBeTruthy();
    expect(evt.hash).not.toBe('0'.repeat(64));
  });

  it('chains hashes across events', () => {
    const evt1 = log.append('ticket.create', { ticket_id: 'tk_aaa00001' });
    const evt2 = log.append('ticket.state_change', { ticket_id: 'tk_aaa00001', to_state: 'DELIVERED' });
    expect(evt2.prev_hash).toBe(evt1.hash);
  });

  it('verifies integrity of valid chain', () => {
    log.append('ticket.create', { ticket_id: 'tk_aaa00001' });
    log.append('ticket.state_change', { ticket_id: 'tk_aaa00001' });
    log.append('ticket.ack', { ticket_id: 'tk_aaa00001' });
    expect(log.verifyIntegrity()).toBe(true);
  });
});
