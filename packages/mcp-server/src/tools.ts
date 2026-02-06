import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HapEngine } from '@hap/core';

export function registerTools(server: McpServer, engine: HapEngine, defaultHuman: string): void {
  server.registerTool(
    'hap_create_ticket',
    {
      description: 'Create a new HAP ticket as the configured agent.',
      inputSchema: {
        to: z.string().describe('Target human, e.g. human:alex').default(defaultHuman),
        summary: z.string().describe('Human-readable summary'),
        file: z.string().optional().describe('Optional file path for modify_file intent'),
        diff: z.string().optional().describe('Unified diff text for artifact pinning'),
        lines_added: z.number().optional(),
        lines_removed: z.number().optional(),
        risk: z.number().optional(),
        priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
        ttl_seconds: z.number().optional(),
        on_timeout: z.enum(['auto_approve', 'auto_reject', 'cancel']).optional(),
      },
    },
    async (params) => {
      const ticket = engine.createTicket({
        to: params.to ?? defaultHuman,
        from: 'agent:mcp',
        summary: params.summary,
        file: params.file,
        diff: params.diff,
        lines_added: params.lines_added,
        lines_removed: params.lines_removed,
        risk: params.risk,
        priority: params.priority,
        ttl_seconds: params.ttl_seconds,
        on_timeout: params.on_timeout,
      });
      engine.deliverTicket(ticket.id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(ticket, null, 2) }],
      };
    }
  );

  server.registerTool(
    'hap_list_pending',
    {
      description: 'List pending HAP tickets for the configured human.',
    },
    async () => {
      const tickets = engine.listPending(defaultHuman);
      if (tickets.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No pending tickets.' }] };
      }
      const summary = tickets.map(t =>
        `${t.id} | ${t.priority} | ${t.intent.summary} | risk=${t.risk.toFixed(2)} | ${t.state}`
      ).join('\n');
      return { content: [{ type: 'text' as const, text: summary }] };
    }
  );

  server.registerTool(
    'hap_get_ticket',
    {
      description: 'Get one HAP ticket by ticket ID.',
      inputSchema: {
        ticket_id: z.string().describe('HAP ticket id, e.g. tk_abc12345'),
      },
    },
    async ({ ticket_id }) => {
      const ticket = engine.getTicket(ticket_id);
      if (!ticket) {
        return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} not found.` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(ticket, null, 2) }] };
    }
  );

  server.registerTool(
    'hap_approve_ticket',
    {
      description: 'Approve a HAP ticket.',
      inputSchema: {
        ticket_id: z.string(),
        comment: z.string().optional(),
        typed_confirmation: z.string().optional().describe("Optional step-up phrase. Use 'approve production' for high-risk approvals."),
      },
    },
    async ({ ticket_id, comment, typed_confirmation }) => {
      const ticket = engine.getTicket(ticket_id);
      if (!ticket) {
        return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} not found.` }], isError: true };
      }
      if (ticket.risk >= 0.7 && typed_confirmation !== 'approve production') {
        return {
          content: [{ type: 'text' as const, text: `High-risk ticket (risk=${ticket.risk}). Requires typed_confirmation="approve production".` }],
          isError: true,
        };
      }
      if (ticket.state === 'DELIVERED' || ticket.state === 'PENDING') {
        engine.ackTicket(ticket_id, defaultHuman);
      }
      engine.approveTicket(ticket_id, defaultHuman, comment);
      return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} APPROVED. ${comment ?? ''}` }] };
    }
  );

  server.registerTool(
    'hap_reject_ticket',
    {
      description: 'Reject a HAP ticket.',
      inputSchema: {
        ticket_id: z.string(),
        comment: z.string().optional(),
      },
    },
    async ({ ticket_id, comment }) => {
      const ticket = engine.getTicket(ticket_id);
      if (!ticket) {
        return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} not found.` }], isError: true };
      }
      if (ticket.state === 'DELIVERED' || ticket.state === 'PENDING') {
        engine.ackTicket(ticket_id, defaultHuman);
      }
      engine.rejectTicket(ticket_id, defaultHuman, comment);
      return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} REJECTED. ${comment ?? ''}` }] };
    }
  );

  server.registerTool(
    'hap_ack_ticket',
    {
      description: 'Acknowledge a HAP ticket (pauses lease timer).',
      inputSchema: {
        ticket_id: z.string(),
        note: z.string().optional(),
      },
    },
    async ({ ticket_id, note }) => {
      engine.ackTicket(ticket_id, defaultHuman, note);
      return { content: [{ type: 'text' as const, text: `Ticket ${ticket_id} acknowledged. Lease timer paused.` }] };
    }
  );
}
