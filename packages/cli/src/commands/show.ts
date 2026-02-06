import type { HapEngine } from '@hap/core';
import { formatTicketDetail } from '../format.js';

export function show(engine: HapEngine, ticketId: string): void {
  const ticket = engine.getTicket(ticketId);
  if (!ticket) {
    console.error(`Ticket ${ticketId} not found.`);
    process.exit(1);
  }
  console.log(formatTicketDetail(ticket));
}
