import { describe, it, expect } from 'vitest';
import { TicketCreateSchema, IntentSignSchema } from './index.js';

describe('TicketCreateSchema', () => {
  it('accepts valid ticket creation', () => {
    const result = TicketCreateSchema.safeParse({
      to: 'human:alex',
      intent: {
        kind: 'modify_file',
        summary: 'Refactor auth middleware',
        details: { file: 'src/auth.ts', lines_added: 5, lines_removed: 2 },
      },
      lease: { ttl_seconds: 3600, on_timeout: 'auto_reject' },
      risk: 0.22,
      priority: 'normal',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid risk score', () => {
    const result = TicketCreateSchema.safeParse({
      to: 'human:alex',
      intent: { kind: 'modify_file', summary: 'x', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 1.5,
      priority: 'normal',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid human ID format', () => {
    const result = TicketCreateSchema.safeParse({
      to: 'badformat',
      intent: { kind: 'modify_file', summary: 'x', details: {} },
      lease: { ttl_seconds: 60, on_timeout: 'auto_reject' },
      risk: 0.1,
      priority: 'normal',
    });
    expect(result.success).toBe(false);
  });
});

describe('IntentSignSchema', () => {
  it('accepts valid approval', () => {
    const result = IntentSignSchema.safeParse({
      ticket_id: 'tk_abc12345',
      decision: 'approve',
      comment: 'LGTM',
    });
    expect(result.success).toBe(true);
  });

  it('accepts rejection with comment', () => {
    const result = IntentSignSchema.safeParse({
      ticket_id: 'tk_abc12345',
      decision: 'reject',
      comment: 'Needs tests',
    });
    expect(result.success).toBe(true);
  });
});
