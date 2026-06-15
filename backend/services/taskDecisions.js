import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'kept-tasks.json');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

// Record that the user swiped "Keep" on this task just now, and drop any
// entries from previous days while we're at it.
export function recordKeep(taskId) {
  const today = todayKey();
  const kept = load();
  for (const [id, day] of Object.entries(kept)) {
    if (day !== today) delete kept[id];
  }
  kept[taskId] = today;
  save(kept);
}

// Ids of tasks swiped "Keep" today — skip these in the review queue so they
// don't reappear later the same day.
export function getRecentlyKeptIds() {
  const today = todayKey();
  const kept = load();
  return new Set(Object.entries(kept).filter(([, day]) => day === today).map(([id]) => id));
}
