import { randomBytes } from 'node:crypto';
import type { Storage } from './storage.js';
import type { EventLog } from './events.js';
import type { Ticket, TicketState, TicketCreateInput } from '@hap/shared';
import { TERMINAL_STATES } from '@hap/shared';
import { LeaseManager } from './leases.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['DELIVERED', 'CANCELED', 'EXPIRED'],
  DELIVERED: ['ACKED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELED', 'EXPIRED'],
  ACKED: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELED'],
};

export class TicketService {
  private leases: LeaseManager;

  constructor(private storage: Storage, private eventLog: EventLog) {
    this.leases = new LeaseManager((ticketId, action) => {
      this.handleTimeout(ticketId, action);
    });
  }

  create(input: TicketCreateInput, from: string): Ticket {
    const id = `tk_${randomBytes(6).toString('hex')}`;
    const ticket = this.storage.createTicket({
      id,
      from,
      to: input.to,
      intent: input.intent,
      artifact: input.artifact ?? null,
      lease: input.lease,
      risk: input.risk,
      priority: input.priority,
      state: 'PENDING',
    });
    this.eventLog.append('ticket.create', {
      ticket_id: id, from, to: input.to,
      intent_kind: input.intent.kind, risk: input.risk, priority: input.priority,
    });
    return ticket;
  }

  deliver(ticketId: string): Ticket {
    return this.transition(ticketId, 'DELIVERED', () => {
      const ticket = this.storage.getTicket(ticketId)!;
      this.leases.start(ticketId, ticket.lease.ttl_seconds, ticket.lease.on_timeout);
      this.eventLog.append('ticket.state_change', {
        ticket_id: ticketId, from_state: 'PENDING', to_state: 'DELIVERED',
      });
    });
  }

  ack(ticketId: string, from: string, note?: string): Ticket {
    return this.transition(ticketId, 'ACKED', () => {
      this.leases.pause(ticketId);
      this.eventLog.append('ticket.ack', {
        ticket_id: ticketId, from, note: note ?? '',
      });
    });
  }

  resolve(ticketId: string, from: string, decision: 'approve' | 'reject' | 'request_changes', comment?: string): Ticket {
    const stateMap: Record<string, TicketState> = {
      approve: 'APPROVED',
      reject: 'REJECTED',
      request_changes: 'CHANGES_REQUESTED',
    };
    const targetState = stateMap[decision];
    return this.transition(ticketId, targetState, () => {
      this.leases.clear(ticketId);
      this.eventLog.append('intent.sign', {
        ticket_id: ticketId, from, decision, comment: comment ?? '',
      });
    });
  }

  cancel(ticketId: string, from: string, reason?: string): Ticket {
    return this.transition(ticketId, 'CANCELED', () => {
      this.leases.clear(ticketId);
      this.eventLog.append('ticket.cancel', {
        ticket_id: ticketId, from, reason: reason ?? '',
      });
    });
  }

  get(ticketId: string): Ticket | null {
    return this.storage.getTicket(ticketId);
  }

  listPending(humanId: string): Ticket[] {
    return this.storage.listPendingTickets(humanId);
  }

  dispose(): void {
    this.leases.dispose();
  }

  private handleTimeout(ticketId: string, action: string): void {
    const ticket = this.storage.getTicket(ticketId);
    if (!ticket || (TERMINAL_STATES as readonly string[]).includes(ticket.state)) return;

    let targetState: TicketState;
    if (action === 'auto_approve') targetState = 'APPROVED';
    else if (action === 'auto_reject') targetState = 'EXPIRED';
    else targetState = 'CANCELED';

    this.storage.updateTicketState(ticketId, targetState);
    this.eventLog.append('ticket.timeout', {
      ticket_id: ticketId, action_taken: action,
      reason: `Lease expired after ${ticket.lease.ttl_seconds} seconds`,
    });
  }

  private transition(ticketId: string, targetState: TicketState, sideEffect: () => void): Ticket {
    const ticket = this.storage.getTicket(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

    const allowed = VALID_TRANSITIONS[ticket.state];
    if (!allowed || !allowed.includes(targetState)) {
      throw new Error(`Invalid transition: ${ticket.state} -> ${targetState}`);
    }

    sideEffect();
    this.storage.updateTicketState(ticketId, targetState);
    return this.storage.getTicket(ticketId)!;
  }
}
