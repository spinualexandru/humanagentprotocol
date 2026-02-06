import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HapEngine } from '@hap/core';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export function createHapMcpServer(dbPath: string, defaultHuman: string) {
  const engine = new HapEngine(dbPath);

  const server = new McpServer({
    name: 'hap-bridge',
    version: '0.1.0',
  });

  registerTools(server, engine, defaultHuman);
  registerResources(server, engine, defaultHuman);

  return { server, engine };
}
