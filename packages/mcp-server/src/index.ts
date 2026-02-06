import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHapMcpServer } from './server.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const dbPath = process.env.HAP_DB_PATH ?? resolve(homedir(), '.hap', 'hap.db');
const humanId = process.env.HAP_HUMAN_ID ?? 'human:alex';

mkdirSync(resolve(dbPath, '..'), { recursive: true });

const { server } = createHapMcpServer(dbPath, humanId);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('HAP MCP Server failed to start:', err);
  process.exit(1);
});
