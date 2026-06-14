import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'kept-projects.json');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// Record that the user swiped "Keep" on this project just now, and drop any
// entries older than the retention window while we're at it.
export function recordKeep(projectId) {
  const cutoff = Date.now() - RETENTION_MS;
  const kept = load();
  for (const [id, ts] of Object.entries(kept)) {
    if (ts < cutoff) delete kept[id];
  }
  kept[projectId] = Date.now();
  save(kept);
}

// Ids of projects swiped "Keep" within the last 7 days — skip these in the review queue.
export function getRecentlyKeptIds() {
  const cutoff = Date.now() - RETENTION_MS;
  const kept = load();
  return new Set(Object.entries(kept).filter(([, ts]) => ts >= cutoff).map(([id]) => id));
}
