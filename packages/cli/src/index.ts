import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { HapEngine } from '@hap/core';
import { inbox } from './commands/inbox.js';
import { show } from './commands/show.js';
import { approve } from './commands/approve.js';
import { reject } from './commands/reject.js';
import { ack } from './commands/ack.js';

const dbPath = process.env.HAP_DB_PATH ?? resolve(homedir(), '.hap', 'hap.db');
const humanId = process.env.HAP_HUMAN_ID ?? 'human:alex';
mkdirSync(resolve(dbPath, '..'), { recursive: true });

const args = process.argv.slice(2);
const command = args[0];

const engine = new HapEngine(dbPath);

try {
  switch (command) {
    case 'inbox':
    case 'list':
      inbox(engine, humanId);
      break;
    case 'show':
      if (!args[1]) { console.error('Usage: hap show <ticket_id>'); process.exit(1); }
      show(engine, args[1]);
      break;
    case 'approve':
      if (!args[1]) { console.error('Usage: hap approve <ticket_id> [comment]'); process.exit(1); }
      approve(engine, args[1], humanId, args.slice(2).join(' ') || undefined);
      break;
    case 'reject':
      if (!args[1]) { console.error('Usage: hap reject <ticket_id> [comment]'); process.exit(1); }
      reject(engine, args[1], humanId, args.slice(2).join(' ') || undefined);
      break;
    case 'ack':
      if (!args[1]) { console.error('Usage: hap ack <ticket_id> [note]'); process.exit(1); }
      ack(engine, args[1], humanId, args.slice(2).join(' ') || undefined);
      break;
    case 'events':
      console.log(JSON.stringify(engine.getEvents(), null, 2));
      break;
    case 'verify':
      console.log(engine.verifyEventLog() ? '\u2713 Event log integrity verified.' : '\u2717 Event log integrity check FAILED!');
      break;
    default:
      console.log(`HAP CLI \u2014 Human-Agent Protocol

Usage:
  hap inbox                          List pending tickets
  hap show <ticket_id>               Show ticket details
  hap ack <ticket_id> [note]         Acknowledge ticket (pause timer)
  hap approve <ticket_id> [comment]  Approve ticket
  hap reject <ticket_id> [comment]   Reject ticket
  hap events                         Show event log
  hap verify                         Verify event log integrity

Environment:
  HAP_DB_PATH    SQLite database path (default: ~/.hap/hap.db)
  HAP_HUMAN_ID   Human identifier (default: human:alex)`);
  }
} finally {
  engine.dispose();
}
