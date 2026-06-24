import { randomUUID } from 'node:crypto';

const TOKEN = process.env.TODOIST_API_TOKEN;
if (!TOKEN) {
  throw new Error('TODOIST_API_TOKEN environment variable not set.');
}

const BASE = 'https://api.todoist.com/api/v1';

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function fetchAllPages(path, params = {}) {
  const results = [];
  let cursor = null;
  while (true) {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: authHeaders() });
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

export async function getTasksDueToday() {
  return fetchAllPages('/tasks/filter', { query: 'date:today', limit: 200 });
}

export async function createProject(name) {
  const res = await fetch(`${BASE}/projects`, {
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
  const res = await fetch(`${BASE}/projects/${id}/archive`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Todoist archiveProject(${id}) failed: ${res.status} ${await res.text()}`);
  }
  return res.json().catch(() => ({}));
}

export async function unarchiveProject(id) {
  const res = await fetch(`${BASE}/projects/${id}/unarchive`, {
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
    const res = await fetch(`${BASE}/sync`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ commands: batch }),
    });
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
  const res = await fetch(`${BASE}/tasks/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist deleteTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function closeTask(id) {
  const res = await fetch(`${BASE}/tasks/${id}/close`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist closeTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function reopenTask(id) {
  const res = await fetch(`${BASE}/tasks/${id}/reopen`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Todoist reopenTask(${id}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function postComment({ taskId, projectId, content }) {
  const body = taskId ? { task_id: taskId, content } : { project_id: projectId, content };
  const res = await fetch(`${BASE}/comments`, {
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
    const res = await fetch(`${BASE}/labels`, {
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
