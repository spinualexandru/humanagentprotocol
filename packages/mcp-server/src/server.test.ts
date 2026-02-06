import { describe, it, expect } from 'vitest';
import { createHapMcpServer } from './server.js';

describe('HAP MCP Server', () => {
  it('creates server with engine', () => {
    const { server, engine } = createHapMcpServer(':memory:', 'human:test');
    expect(server).toBeDefined();
    expect(engine).toBeDefined();
    engine.dispose();
  });

  it('engine works through server factory', () => {
    const { engine } = createHapMcpServer(':memory:', 'human:test');
    const ticket = engine.createTicket({
      to: 'human:test', from: 'agent:test', summary: 'Test ticket',
    });
    expect(ticket.id).toMatch(/^tk_/);
    expect(ticket.state).toBe('PENDING');
    engine.dispose();
  });

  it('full lifecycle via MCP server engine', () => {
    const { engine } = createHapMcpServer(':memory:', 'human:alex');

    const ticket = engine.createTicket({
      to: 'human:alex',
      from: 'agent:mcp',
      summary: 'Test via MCP',
    });
    engine.deliverTicket(ticket.id);
    expect(engine.listPending('human:alex')).toHaveLength(1);

    engine.approveTicket(ticket.id, 'human:alex');
    expect(engine.getTicket(ticket.id)!.state).toBe('APPROVED');
    expect(engine.verifyEventLog()).toBe(true);

    engine.dispose();
  });
});
