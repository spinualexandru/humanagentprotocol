import type { HapEngine } from '@hap/core';

export function ack(engine: HapEngine, ticketId: string, humanId: string, note?: string): void {
  engine.ackTicket(ticketId, humanId, note);
  console.log(`\u2713 Ticket ${ticketId} acknowledged. Lease timer paused.`);
}
