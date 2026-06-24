import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'kept-projects.json');
const BACKLOGGED_FILE = path.join(DATA_DIR, 'backlogged-projects.json');
const HIDDEN_FILE = path.join(DATA_DIR, 'hidden-projects.json');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HIDE_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

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

// ── Backlogged / Someday tracking ───────────────────────────────────────────

function loadBacklogged() {
  try {
    return JSON.parse(fs.readFileSync(BACKLOGGED_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveBacklogged(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BACKLOGGED_FILE, JSON.stringify(data, null, 2));
}

// type: 'backlog' | 'someday', originalColor: Todoist color string (may be null)
export function recordBacklogged(projectId, { type, originalColor }) {
  const data = loadBacklogged();
  data[projectId] = { ts: Date.now(), type, originalColor: originalColor ?? null };
  saveBacklogged(data);
}

export function clearBacklogged(projectId) {
  const data = loadBacklogged();
  delete data[projectId];
  saveBacklogged(data);
}

export function getBackloggedEntry(projectId) {
  return loadBacklogged()[projectId] ?? null;
}

export function getBackloggedIds() {
  return new Set(Object.keys(loadBacklogged()));
}

// ── Hidden tracking (120-day snooze, no Todoist changes) ────────────────────

function loadHidden() {
  try {
    return JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveHidden(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HIDDEN_FILE, JSON.stringify(data, null, 2));
}

export function recordHide(projectId) {
  const data = loadHidden();
  data[projectId] = Date.now();
  saveHidden(data);
}

export function clearHide(projectId) {
  const data = loadHidden();
  delete data[projectId];
  saveHidden(data);
}

export function getHiddenIds() {
  const cutoff = Date.now() - HIDE_RETENTION_MS;
  const data = loadHidden();
  return new Set(Object.entries(data).filter(([, ts]) => ts >= cutoff).map(([id]) => id));
}
