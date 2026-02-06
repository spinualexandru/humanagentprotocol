import type { HapEngine } from '@hap/core';

export function reject(engine: HapEngine, ticketId: string, humanId: string, comment?: string): void {
  const ticket = engine.getTicket(ticketId);
  if (!ticket) {
    console.error(`Ticket ${ticketId} not found.`);
    process.exit(1);
  }
  if (ticket.state === 'PENDING' || ticket.state === 'DELIVERED') {
    engine.ackTicket(ticketId, humanId);
  }
  engine.rejectTicket(ticketId, humanId, comment);
  console.log(`\u2717 Ticket ${ticketId} rejected.`);
}
