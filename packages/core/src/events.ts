import { createHash, randomBytes } from 'node:crypto';
import type { Storage } from './storage.js';
import type { HapEvent } from '@hap/shared';

const GENESIS_HASH = '0'.repeat(64);

function computeEventHash(payload: Record<string, unknown>, prevHash: string): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const data = `${prevHash}||${canonical}`;
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

export class EventLog {
  constructor(private storage: Storage) {}

  append(type: string, payload: Record<string, unknown>): HapEvent {
    const lastEvent = this.storage.getLastEvent();
    const prevHash = lastEvent?.hash ?? GENESIS_HASH;

    const event: HapEvent = {
      id: `evt_${randomBytes(8).toString('hex')}`,
      type,
      ts: new Date().toISOString(),
      payload,
      prev_hash: prevHash,
      hash: '',
    };

    event.hash = computeEventHash(event.payload, prevHash);
    this.storage.appendEvent(event);
    return event;
  }

  verifyIntegrity(): boolean {
    const events = this.storage.getEvents();
    let prevHash = GENESIS_HASH;
    for (const event of events) {
      const expected = computeEventHash(event.payload, prevHash);
      if (event.hash !== expected) return false;
      prevHash = event.hash;
    }
    return true;
  }

  getAll(): HapEvent[] {
    return this.storage.getEvents();
  }
}
