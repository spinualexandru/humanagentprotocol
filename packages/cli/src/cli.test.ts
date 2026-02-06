import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HapEngine } from '@hap/core';
import { formatTicketTable, formatTicketDetail } from './format.js';

describe('CLI formatting', () => {
  let engine: HapEngine;

  beforeEach(() => {
    engine = new HapEngine(':memory:');
  });

  afterEach(() => {
    engine.dispose();
  });

  it('formats empty ticket table', () => {
    const output = formatTicketTable([]);
    expect(output).toBe('No pending tickets.');
  });

  it('formats ticket table with entries', () => {
    const t = engine.createTicket({ to: 'human:alex', summary: 'Fix auth bug', from: 'agent:test', priority: 'high', risk: 0.65 });
    engine.deliverTicket(t.id);
    const tickets = engine.listPending('human:alex');
    const output = formatTicketTable(tickets);
    expect(output).toContain('Fix auth bug');
    expect(output).toContain('high');
  });

  it('formats ticket detail', () => {
    const ticket = engine.createTicket({ to: 'human:alex', summary: 'Deploy to staging', from: 'agent:test' });
    const output = formatTicketDetail(ticket);
    expect(output).toContain(ticket.id);
    expect(output).toContain('Deploy to staging');
  });

  it('formats ticket detail with diff', () => {
    const ticket = engine.createTicket({
      to: 'human:alex', summary: 'Fix typo', from: 'agent:test',
      file: 'README.md', diff: '--- a/README.md\n+++ b/README.md\n-old\n+new',
      lines_added: 1, lines_removed: 1,
    });
    const output = formatTicketDetail(ticket);
    expect(output).toContain('README.md');
    expect(output).toContain('--- Diff ---');
  });
});
