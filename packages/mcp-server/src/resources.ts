import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HapEngine } from '@hap/core';

export function registerResources(server: McpServer, engine: HapEngine, defaultHuman: string): void {
  server.registerResource(
    'pending-tickets',
    'hap://tickets/pending',
    { description: 'List of pending HAP tickets', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify(engine.listPending(defaultHuman), null, 2),
        mimeType: 'application/json',
      }],
    })
  );

  server.registerResource(
    'all-tickets',
    'hap://tickets/all',
    { description: 'All HAP tickets', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify(engine.listAll(), null, 2),
        mimeType: 'application/json',
      }],
    })
  );

  server.registerResource(
    'event-log',
    'hap://events',
    { description: 'HAP event log', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        text: JSON.stringify(engine.getEvents(), null, 2),
        mimeType: 'application/json',
      }],
    })
  );
}
