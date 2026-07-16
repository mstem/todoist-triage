// One-time (re-runnable) backfill of the completed-task wiki.
//   node backend/scripts/backfill-wiki.js [--since YYYY-MM-DD] [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env before importing anything that touches services/todoist.js,
// which throws at import time without TODOIST_API_TOKEN (same loader as
// server.js).
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx !== -1 ? args[sinceIdx + 1] : undefined;

const { backfillAll } = await import('../services/wikiSync.js');

try {
  await backfillAll({ since, dryRun });
} catch (err) {
  console.error(`Backfill failed: ${err.message}`);
  process.exit(1);
}
