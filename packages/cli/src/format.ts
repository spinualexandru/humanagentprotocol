import type { Ticket } from '@hap/shared';

function riskColor(risk: number): string {
  if (risk < 0.3) return '\x1b[32m';
  if (risk < 0.7) return '\x1b[33m';
  return '\x1b[31m';
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatTicketTable(tickets: Ticket[]): string {
  if (tickets.length === 0) return 'No pending tickets.';
  const header = `${BOLD}  ID              Priority   Summary                         Risk     State       Age${RESET}`;
  const sep = '  ' + '\u2500'.repeat(88);
  const rows = tickets.map(t => {
    const rc = riskColor(t.risk);
    return `  ${t.id.padEnd(16)}${t.priority.padEnd(11)}${t.intent.summary.slice(0, 32).padEnd(32)}${rc}${t.risk.toFixed(2)}${RESET}     ${t.state.padEnd(12)}${timeAgo(t.created_at)}`;
  });
  return [header, sep, ...rows].join('\n');
}

export function formatTicketDetail(ticket: Ticket): string {
  const rc = riskColor(ticket.risk);
  const lines = [
    `${BOLD}Ticket: ${ticket.id}${RESET}`,
    `From:     ${ticket.from}`,
    `To:       ${ticket.to}`,
    `Priority: ${ticket.priority}`,
    `Risk:     ${rc}${ticket.risk.toFixed(2)}${RESET}`,
    `State:    ${ticket.state}`,
    `Created:  ${ticket.created_at} (${timeAgo(ticket.created_at)})`,
    `Lease:    ${ticket.lease.ttl_seconds}s (${ticket.lease.on_timeout} on timeout)`,
    '',
    `${BOLD}Intent:${RESET} ${ticket.intent.kind}`,
    `${BOLD}Summary:${RESET} ${ticket.intent.summary}`,
  ];
  const details = ticket.intent.details as Record<string, any>;
  if (details.file) lines.push(`File: ${details.file}`);
  if (details.diff) lines.push(`\n${DIM}--- Diff ---${RESET}\n${details.diff}`);
  if (details.lines_added || details.lines_removed) {
    lines.push(`Changes: +${details.lines_added ?? 0} -${details.lines_removed ?? 0}`);
  }
  return lines.join('\n');
}
