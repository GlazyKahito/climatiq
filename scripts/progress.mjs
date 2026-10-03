#!/usr/bin/env node
// Dev-only helper that updates progress.json (shown live at /progress).
// Usage:
//   node scripts/progress.mjs set <id> <todo|doing|done|blocked> ["note"]
//   node scripts/progress.mjs log "message"
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'progress.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const now = new Date().toISOString();
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'set') {
  const [id, status, note] = args;
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown item: ${id}`);
  item.status = status;
  if (note !== undefined) item.note = note;
  data.log.unshift({ time: now, msg: `${item.title} → ${status}${note ? ` (${note})` : ''}` });
} else if (cmd === 'log') {
  data.log.unshift({ time: now, msg: args.join(' ') });
} else {
  console.error('Usage: progress.mjs set <id> <status> [note] | log <message>');
  process.exit(1);
}
data.log = data.log.slice(0, 200);
data.updatedAt = now;
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
