import type { HapEngine } from '@hap/core';
import { formatTicketTable } from '../format.js';

export function inbox(engine: HapEngine, humanId: string): void {
  const tickets = engine.listPending(humanId);
  console.log(formatTicketTable(tickets));
}
