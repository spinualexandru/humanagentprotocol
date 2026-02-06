import { Storage } from './storage.js';
import { EventLog } from './events.js';
import { TicketService } from './tickets.js';
import type { Ticket, TicketCreateInput } from '@hap/shared';

export interface SimpleTicketInput {
  to: string;
  from: string;
  summary: string;
  intent_kind?: string;
  details?: Record<string, unknown>;
  diff?: string;
  file?: string;
  lines_added?: number;
  lines_removed?: number;
  risk?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  ttl_seconds?: number;
  on_timeout?: 'auto_approve' | 'auto_reject' | 'cancel';
}

function computeRisk(input: SimpleTicketInput): number {
  if (input.risk !== undefined) return input.risk;
  const linesChanged = (input.lines_added ?? 0) + (input.lines_removed ?? 0);
  let scopeFactor: number;
  if (linesChanged < 10) scopeFactor = 0.1;
  else if (linesChanged < 50) scopeFactor = 0.3;
  else if (linesChanged < 200) scopeFactor = 0.6;
  else scopeFactor = 0.9;
  return Math.min(1.0, scopeFactor * 0.4 + 0.3 * 0.4 + 0.5 * 0.2);
}

export class HapEngine {
  private storage: Storage;
  private eventLog: EventLog;
  private ticketService: TicketService;

  constructor(dbPath: string) {
    this.storage = new Storage(dbPath);
    this.eventLog = new EventLog(this.storage);
    this.ticketService = new TicketService(this.storage, this.eventLog);
  }

  createTicket(input: SimpleTicketInput): Ticket {
    const fullInput: TicketCreateInput = {
      to: input.to,
      intent: {
        kind: input.intent_kind ?? 'modify_file',
        summary: input.summary,
        details: input.details ?? {
          file: input.file,
          diff: input.diff,
          lines_added: input.lines_added,
          lines_removed: input.lines_removed,
        },
      },
      lease: {
        ttl_seconds: input.ttl_seconds ?? 3600,
        on_timeout: input.on_timeout ?? 'auto_reject',
      },
      risk: computeRisk(input),
      priority: input.priority ?? 'normal',
    };
    return this.ticketService.create(fullInput, input.from);
  }

  deliverTicket(ticketId: string): Ticket {
    return this.ticketService.deliver(ticketId);
  }

  ackTicket(ticketId: string, humanId: string, note?: string): Ticket {
    return this.ticketService.ack(ticketId, humanId, note);
  }

  approveTicket(ticketId: string, humanId: string, comment?: string): Ticket {
    return this.ticketService.resolve(ticketId, humanId, 'approve', comment);
  }

  rejectTicket(ticketId: string, humanId: string, comment?: string): Ticket {
    return this.ticketService.resolve(ticketId, humanId, 'reject', comment);
  }

  cancelTicket(ticketId: string, from: string, reason?: string): Ticket {
    return this.ticketService.cancel(ticketId, from, reason);
  }

  getTicket(ticketId: string): Ticket | null {
    return this.ticketService.get(ticketId);
  }

  listPending(humanId: string): Ticket[] {
    return this.ticketService.listPending(humanId);
  }

  listAll(): Ticket[] {
    return this.storage.listAllTickets();
  }

  verifyEventLog(): boolean {
    return this.eventLog.verifyIntegrity();
  }

  getEvents() {
    return this.eventLog.getAll();
  }

  dispose(): void {
    this.ticketService.dispose();
    this.storage.close();
  }
}
