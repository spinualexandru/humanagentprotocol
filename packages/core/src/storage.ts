import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import type { Ticket, HapEvent } from '@hap/shared';

interface TicketRow {
  id: string;
  from: string;
  to: string;
  intent: string;
  artifact: string | null;
  lease: string;
  risk: number;
  priority: string;
  state: string;
  created_at: string;
  updated_at: string;
}

function rowToTicket(row: TicketRow): Ticket {
  return {
    ...row,
    intent: JSON.parse(row.intent),
    artifact: row.artifact ? JSON.parse(row.artifact) : null,
    lease: JSON.parse(row.lease),
  } as Ticket;
}

export class Storage {
  public db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    migrate(this.db);
  }

  createTicket(ticket: Omit<Ticket, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }): Ticket {
    const now = new Date().toISOString();
    const row = {
      id: ticket.id,
      from: ticket.from,
      to: ticket.to,
      intent: JSON.stringify(ticket.intent),
      artifact: ticket.artifact ? JSON.stringify(ticket.artifact) : null,
      lease: JSON.stringify(ticket.lease),
      risk: ticket.risk,
      priority: ticket.priority,
      state: ticket.state,
      created_at: ticket.created_at ?? now,
      updated_at: ticket.updated_at ?? now,
    };
    this.db.prepare(`
      INSERT INTO tickets (id, "from", "to", intent, artifact, lease, risk, priority, state, created_at, updated_at)
      VALUES (@id, @from, @to, @intent, @artifact, @lease, @risk, @priority, @state, @created_at, @updated_at)
    `).run(row);
    return this.getTicket(ticket.id)!;
  }

  getTicket(id: string): Ticket | null {
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
    return row ? rowToTicket(row) : null;
  }

  updateTicketState(id: string, state: string): void {
    this.db.prepare(`UPDATE tickets SET state = ?, updated_at = datetime('now') WHERE id = ?`).run(state, id);
  }

  listPendingTickets(humanId: string): Ticket[] {
    const rows = this.db.prepare(
      `SELECT * FROM tickets WHERE "to" = ? AND state IN ('PENDING', 'DELIVERED', 'ACKED') ORDER BY created_at DESC`
    ).all(humanId) as TicketRow[];
    return rows.map(rowToTicket);
  }

  listAllTickets(): Ticket[] {
    const rows = this.db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all() as TicketRow[];
    return rows.map(rowToTicket);
  }

  appendEvent(event: HapEvent): void {
    this.db.prepare(`
      INSERT INTO events (id, type, ts, payload, prev_hash, hash)
      VALUES (@id, @type, @ts, @payload, @prev_hash, @hash)
    `).run({
      ...event,
      payload: JSON.stringify(event.payload),
    });
  }

  getEvents(): HapEvent[] {
    const rows = this.db.prepare('SELECT * FROM events ORDER BY rowid ASC').all() as any[];
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  getLastEvent(): HapEvent | null {
    const row = this.db.prepare('SELECT * FROM events ORDER BY rowid DESC LIMIT 1').get() as any;
    return row ? { ...row, payload: JSON.parse(row.payload) } : null;
  }

  isNonceUsed(nonce: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM used_nonces WHERE nonce = ?').get(nonce);
    return !!row;
  }

  markNonceUsed(nonce: string, ticketId: string): void {
    this.db.prepare('INSERT INTO used_nonces (nonce, ticket_id) VALUES (?, ?)').run(nonce, ticketId);
  }

  getConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
