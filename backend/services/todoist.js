import { randomUUID } from 'node:crypto';

const TOKEN = process.env.TODOIST_API_TOKEN;
if (!TOKEN) {
  throw new Error('TODOIST_API_TOKEN environment variable not set.');
}

const BASE = 'https://api.todoist.com/api/v1';

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

// Todoist fails in two transient ways and both used to sink a whole page load.
// 1. undici throws a bare TypeError "fetch failed" on network-level errors
//    (dropped connection, DNS hiccup, TLS reset) with no HTTP status.
// 2. The API itself answers 429/5xx under load — the review queue fans out one
//    /tasks call per project, and a single 502 in that burst surfaced as
//    "Couldn't load projects: Todoist GET /tasks failed: 502".
// Both are retried with exponential backoff, honouring Retry-After when sent.
// Status retries only apply to safely repeatable calls — GETs, and the /sync
// endpoint whose commands carry a uuid Todoist dedupes on. A plain POST that
// 502s may already have created the project or comment, so it is handed back
// to the caller rather than fired again. Other HTTP errors (4xx) return as-is.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryAfterMs(res) {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), 10_000);
}

async function fetchWithRetry(url, options = {}, { retries = 3, baseDelayMs = 300, idempotent } = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const retryStatuses = idempotent ?? method === 'GET';
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(`[todoist] fetch ${url} failed (${err.message}), retry ${attempt + 1}/${retries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!retryStatuses || !RETRYABLE_STATUSES.has(res.status) || attempt === retries) return res;
    // Jitter so 15 concurrent callers don't all retry on the same beat.
    const delay = retryAfterMs(res) ?? baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 200);
    console.warn(`[todoist] fetch ${url} got ${res.status}, retry ${attempt + 1}/${retries} in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastErr;
}

async function fetchAllPages(path, params = {}) {
  const results = [];
  let cursor = null;
  while (true) {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetchWithRetry(url, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`Todoist GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const page = Array.isArray(data) ? data : (data.results ?? []);
    results.push(...page);
    cursor = Array.isArray(data) ? null : data.next_cursor;
    if (!cursor) break;
  }
  return results;
}

export async function getProjects() {
  return fetchAllPages('/projects', { limit: 200 });
}

export async function getTasksForProject(projectId) {
  return fetchAllPages('/tasks', { project_id: projectId, limit: 200 });
}

// Every active task in a single request, for callers that need tasks across
// many projects at once. Todoist rate-limits per user, and a full sync returns
// all items at once where REST would need a call per project (or 27 cursor
// pages). Completed and deleted items are filtered out to match /tasks.
export async function getAllTasks() {
  const res = await fetchWithRetry(`${BASE}/sync`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sync_token: '*', resource_types: ['items'] }),
  }, { idempotent: true });
  if (!res.ok) {
    throw new Error(`Todoist getAllTasks failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.items ?? []).filter(item => !item.checked && !item.is_deleted);
}

export async function getTasksDueToday() {
  return fetchAllPages('/tasks/filter', { query: 'date:today', limit: 200 });
}

// Everything that has left the today list without being done, by either route: swiped
// to Backlog here, or given up on by the nightly roll-forward once its push count passed
// ROLLOVER_LIMIT. Both apply this one label and clear the due date, so no date-based
// query finds these tasks and the label is the only handle on them.
export const BACKLOG_LABEL = 'backlog';

// Mirrors ROLLOVER_LIMIT in rollforward.py. Only used to mark which rows on the Backlog
// page got there by stalling rather than by a deliberate swipe — the script owns the
// actual decision, so set it in both places if you change it.
export const ROLLOVER_LIMIT = Number(process.env.ROLLOVER_LIMIT) || 21;

export async function getBacklogTasks() {
  return fetchAllPages('/tasks/filter', { query: `@${BACKLOG_LABEL}`, limit: 200 });
}

export async function createProject(name) {
  const res = await fetchWithRetry(`${BASE}/projects`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`Todoist createProject(${name}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function archiveProject(id) {
  const res = await fetchWithRetry(`${BASE}/projects/${id}/archive`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Todoist archiveProject(${id}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json().catch(() => ({}));
}

export async function unarchiveProject(id) {
  const res = await fetchWithRetry(`${BASE}/projects/${id}/unarchive`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Todoist unarchiveProject(${id}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json().catch(() => ({}));
}

async function syncCommands(commands) {
  const BATCH_SIZE = 100;
  const syncStatus = {};
  for (let i = 0; i < commands.length; i += BATCH_SIZE) {
    const batch = commands.slice(i, i + BATCH_SIZE);
    const res = await fetchWithRetry(`${BASE}/sync`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ commands: batch }),
    }, { idempotent: true });
    if (!res.ok) {
      throw new Error(`Todoist sync failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    Object.assign(syncStatus, data.sync_status || {});
  }
  return syncStatus;
}

async function syncCommand(type, args) {
  const uuid = randomUUID();
  const status = await syncCommands([{ type, uuid, args }]);
  const result = status[uuid];
  if (result !== 'ok') {
    throw new Error(`Todoist sync command ${type} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function moveProjectToParent(id, parentId) {
  const args = parentId != null ? { id, parent_id: parentId } : { id };
  return syncCommand('project_move', args);
}

export async function updateProjectColor(id, color) {
  return syncCommand('project_update', { id, color });
}

export async function moveTaskToProject(id, projectId) {
  return syncCommand('item_move', { id, project_id: projectId });
}

export async function applyLabelAndClearDue(task, labelName) {
  const labels = Array.from(new Set([...(task.labels || []), labelName]));
  return syncCommand('item_update', { id: task.id, labels, due: null });
}

// Put a backlogged task back on today's list: drop the label that keeps it out of the
// deck and give it today's date, so the next roll-forward treats it as a normal task
// again. Its postponed_count is untouched, so a task that stalled its way here and is
// pushed again lands back on the Backlog page.
export async function restoreBacklogTask(task) {
  const labels = (task.labels || []).filter(l => l !== BACKLOG_LABEL);
  const date = formatLocalDate(new Date());
  await syncCommand('item_update', {
    id: task.id,
    labels,
    due: { date, string: date, is_recurring: false, lang: 'en' },
  });
  return { date };
}

export async function clearDueDate(id) {
  return syncCommand('item_update', { id, due: null });
}

export async function updateTask(id, { content, description }) {
  const args = { id };
  if (content !== undefined) args.content = content;
  if (description !== undefined) args.description = description;
  return syncCommand('item_update', args);
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Move a task's due date `days` from today, preserving recurrence — same
// approach as rollforward.py's item_update (string/is_recurring/lang/timezone
// carried over, only `date` changes).
export async function rescheduleTask(id, days, currentDue) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  const date = formatLocalDate(target);
  const due = currentDue || {};
  const newDue = {
    date,
    string: due.string || date,
    is_recurring: due.is_recurring || false,
    lang: due.lang || 'en',
  };
  if (due.timezone) newDue.timezone = due.timezone;
  await syncCommand('item_update', { id, due: newDue });
  return { date };
}

export async function deleteTask(id) {
  const res = await fetchWithRetry(`${BASE}/tasks/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist deleteTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function closeTask(id) {
  const res = await fetchWithRetry(`${BASE}/tasks/${id}/close`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist closeTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function reopenTask(id) {
  const res = await fetchWithRetry(`${BASE}/tasks/${id}/reopen`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist reopenTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function postComment({ taskId, projectId, content }) {
  const body = taskId ? { task_id: taskId, content } : { project_id: projectId, content };
  const res = await fetchWithRetry(`${BASE}/comments`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Todoist postComment failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// BFS over the project tree — ported from rollforward.py collect_work_project_ids
export function collectDescendantIds(projects, rootIds) {
  const all = new Set(rootIds);
  let frontier = new Set(rootIds);
  while (frontier.size) {
    const children = new Set(projects.filter(p => frontier.has(p.parent_id)).map(p => p.id));
    const newOnes = [...children].filter(id => !all.has(id));
    newOnes.forEach(id => all.add(id));
    frontier = new Set(newOnes);
  }
  return all;
}

export async function getOrCreateTopLevelProject(name) {
  const projects = await getProjects();
  const existing = projects.find(
    p => !p.parent_id && p.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing;
  return createProject(name);
}

// Fire-and-forget: labels auto-create on first item_update use anyway,
// this just gives backlog/someday a consistent color from the start.
export async function ensureLabelExists(name) {
  try {
    const res = await fetchWithRetry(`${BASE}/labels`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    });
    if (!res.ok && res.status !== 400) {
      console.warn(`[todoist] ensureLabelExists(${name}) unexpected status ${res.status}`);
    }
  } catch (err) {
    console.warn(`[todoist] ensureLabelExists(${name}) error: ${err.message}`);
  }
}
